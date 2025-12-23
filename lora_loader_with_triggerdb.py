import os
import json
import re
import folder_paths
import comfy.sd
import comfy.utils
from aiohttp import web
import server
from .file_id import get_file_id_safe

def get_user_db_path():
    """Get the user database directory"""
    try:
        # Get the ComfyUI root directory
        comfy_path = folder_paths.base_path
        user_db_path = os.path.join(comfy_path, "user", "default", "user-db")
        os.makedirs(user_db_path, exist_ok=True)
        return user_db_path
    except Exception as e:
        print(f"Error determining user DB path: {e}")
        # Fallback to the old location
        lora_path = folder_paths.get_folder_paths("loras")[0] if folder_paths.get_folder_paths("loras") else ""
        return lora_path


def extract_triggers_from_metadata(meta):
    """Extract trigger words from LoRa metadata"""
    if not isinstance(meta, dict):
        return []
    
    # Try common keys used by Kohya and others
    for key in ["ss_tag_frequency", "ss_tag_strings", "trained_words", "trigger_words"]:
        if key in meta:
            val = meta[key]
            if isinstance(val, str):
                # Sometimes it's a JSON string or comma-separated
                try:
                    val = json.loads(val)
                except Exception:
                    val = [v.strip() for v in val.split(",")]
            if isinstance(val, dict):
                # Kohya's ss_tag_frequency is a dict of word:count
                return list(val.keys())
            if isinstance(val, list):
                return [str(v) for v in val]
    
    # Try to find any key with "trigger" or "word" in it
    for k, v in meta.items():
        if "trigger" in k or "word" in k:
            if isinstance(v, str):
                try:
                    v = json.loads(v)
                except Exception:
                    v = [vv.strip() for vv in v.split(",")]
            if isinstance(v, dict):
                return list(v.keys())
            if isinstance(v, list):
                return [str(x) for x in v]
    return []

def clean_trigger_word(word):
    """Clean trigger word by removing leading numbers and underscores"""
    # Remove leading numbers and underscores, e.g. '1_girl' -> 'girl'
    cleaned = re.sub(r'^\d+_', '', word)
    if cleaned.lower() in {"img", "img_dir", "image_dir"}:
        return None  # Filter out these words
    return cleaned

def build_file_id_to_key_map(triggers_db):
    """
    Build a mapping of file_id -> database_key for all entries that have a file_id.

    Args:
        triggers_db: The triggers database dictionary

    Returns:
        dict: Mapping of file_id (str) -> database_key (str)
    """
    file_id_map = {}
    for db_key, data in triggers_db.items():
        if isinstance(data, dict) and "file_id" in data:
            file_id_map[data["file_id"]] = db_key
    return file_id_map


def read_lora_metadata(lora_path):
    """Read metadata from LoRa file"""
    if not os.path.isfile(lora_path):
        return {}
    
    ext = os.path.splitext(lora_path)[1].lower()
    meta = {}
    
    try:
        if ext == ".safetensors":
            # Read safetensors metadata
            try:
                from safetensors.torch import safe_open
                with safe_open(lora_path, framework="pt", device="cpu") as f:
                    meta = f.metadata()
            except ImportError:
                # Fallback: try to use ComfyUI's built-in loading method
                try:
                    import safetensors
                    with safetensors.safe_open(lora_path, framework="pt", device="cpu") as f:
                        meta = f.metadata()
                except ImportError:
                    print("safetensors not available, cannot read .safetensors metadata")
                    return {}
            except Exception as e:
                print(f"Error reading safetensors metadata from {lora_path}: {e}")
                return {}
        elif ext in [".pt", ".bin"]:
            # Read PyTorch metadata
            try:
                import torch
                data = torch.load(lora_path, map_location="cpu")
                if "metadata" in data:
                    meta = data["metadata"]
                elif "meta" in data:
                    meta = data["meta"]
                else:
                    # Sometimes the dict itself contains metadata
                    meta = data
            except Exception as e:
                print(f"Error reading torch metadata from {lora_path}: {e}")
                return {}
        else:
            print(f"Unsupported file type: {ext}")
            return {}
    except Exception as e:
        print(f"Error reading metadata from {lora_path}: {e}")
        return {}
    
    return meta


class LoRaLoaderWithTriggerDB:
    def __init__(self):
        self.user_db_path = get_user_db_path()
        self.triggers_file = os.path.join(self.user_db_path, "lora-triggers.json")
    
    @classmethod
    def INPUT_TYPES(cls):
        # Get list of LoRa files
        loras = folder_paths.get_filename_list("loras")
        
        return {
            "required": {
                "model": ("MODEL",),
                "lora_name": (loras, {"default": loras[0] if loras else ""}),
                "strength_model": ("FLOAT", {"default": 1.0, "min": -20.0, "max": 20.0, "step": 0.01}),
                "all_triggers": ("STRING", {"multiline": True, "default": "", "dynamicPrompts": False}),
                "active_triggers": ("STRING", {"multiline": True, "default": "", "dynamicPrompts": False}),
            }
        }
    
    RETURN_TYPES = ("MODEL", "STRING", "STRING")
    RETURN_NAMES = ("model", "all_triggers", "active_triggers")
    FUNCTION = "load_lora"
    CATEGORY = "loaders"
    
    def get_lora_base_name(self, lora_name):
        """Get the base name of the LoRa file (without extension), normalized for cross-platform compatibility"""
        # Normalize path separators to forward slashes for cross-platform compatibility
        normalized_name = lora_name.replace("\\", "/")
        return os.path.splitext(normalized_name)[0]
    
    def normalize_lora_key(self, lora_name):
        """Normalize LoRa name for cross-platform database key matching"""
        return lora_name.replace("\\", "/")
    
    def find_lora_in_db(self, triggers_db, lora_name):
        """Find LoRa data in database with cross-platform path matching"""
        # Get the normalized current key
        current_key = self.get_lora_base_name(lora_name)
        
        # First try exact match (fastest)
        if current_key in triggers_db:
            return triggers_db[current_key]
        
        # If no exact match, try cross-platform matching
        # Normalize current key for comparison
        current_normalized = current_key.replace("\\", "/")
        
        # Check all existing keys with normalization
        for stored_key, stored_data in triggers_db.items():
            stored_normalized = stored_key.replace("\\", "/")
            if stored_normalized == current_normalized:
                return stored_data
        
        # No match found
        return {}
    
    def load_lora(self, model, lora_name, strength_model, all_triggers, active_triggers):
        if strength_model == 0:
            return (model, all_triggers, active_triggers)
        
        # Load LoRa
        lora_path = folder_paths.get_full_path("loras", lora_name)
        lora = None
        if os.path.isfile(lora_path):
            lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
        
        if lora is None:
            print(f"Failed to load LoRa: {lora_name}")
            return (model, all_triggers, active_triggers)
        
        # Apply LoRa to model only
        model_lora, _ = comfy.sd.load_lora_for_models(model, None, lora, strength_model, 0)
        
        # Return model with LoRa applied and current trigger words
        return (model_lora, all_triggers, active_triggers)


# API endpoint for loading triggers
@server.PromptServer.instance.routes.post("/lora_triggers")
async def load_lora_triggers(request):
    try:
        data = await request.json()
        lora_name = data.get("lora_name", "")
        
        if not lora_name:
            return web.json_response({"all_triggers": "", "active_triggers": ""})
        
        # Get user database directory and triggers file
        user_db_path = get_user_db_path()
        triggers_file = os.path.join(user_db_path, "lora-triggers.json")
        
        # Load triggers database
        triggers_db = {}
        if os.path.exists(triggers_file):
            try:
                with open(triggers_file, 'r', encoding='utf-8') as f:
                    triggers_db = json.load(f)
            except (json.JSONDecodeError, Exception) as e:
                print(f"Error loading triggers.json: {e}")

        # Migrate all entries that don't have file_ids yet
        db_modified = False
        for db_key, entry_data in list(triggers_db.items()):
            # Convert old string format to dict
            if isinstance(entry_data, str):
                entry_data = {
                    "all_triggers": entry_data,
                    "active_triggers": ""
                }
                triggers_db[db_key] = entry_data
                db_modified = True
                print(f"[MIGRATION] Converted string format to dict: {db_key}")

            # Check if entry needs a file_id
            if isinstance(entry_data, dict) and "file_id" not in entry_data:
                # Try to find the LoRa file
                # db_key is the normalized path without extension
                possible_exts = [".safetensors", ".pt", ".bin"]
                found_path = None
                for ext in possible_exts:
                    test_path = folder_paths.get_full_path("loras", db_key + ext)
                    if test_path and os.path.isfile(test_path):
                        found_path = test_path
                        break

                if found_path:
                    # File exists - calculate file_id
                    file_id = get_file_id_safe(found_path)
                    if file_id:
                        entry_data["file_id"] = file_id
                        triggers_db[db_key] = entry_data
                        db_modified = True
                        print(f"[MIGRATION] Added file_id to {db_key}: {file_id[:8]}...")
                else:
                    # File not found - mark as unknown
                    entry_data["file_id"] = "unknown"
                    triggers_db[db_key] = entry_data
                    db_modified = True
                    print(f"[MIGRATION] Marked missing file as unknown: {db_key}")

        # Save migrated database if needed
        if db_modified:
            try:
                with open(triggers_file, 'w', encoding='utf-8') as f:
                    json.dump(triggers_db, f, indent=2, ensure_ascii=False)
                print(f"[MIGRATION] Updated triggers database with file_ids")
            except Exception as e:
                print(f"Error saving migrated triggers.json: {e}")

        # Get full path to LoRa file and calculate file_id
        lora_path = folder_paths.get_full_path("loras", lora_name)
        current_file_id = None
        if lora_path and os.path.isfile(lora_path):
            current_file_id = get_file_id_safe(lora_path)
            print(f"[DEBUG] LoRa file found: {lora_name}, file_id: {current_file_id[:8] if current_file_id else 'None'}...")
        else:
            print(f"[DEBUG] LoRa file not found: {lora_name}, path: {lora_path}")

        lora_data = {}

        # Try file_id-based lookup first if we have a file_id
        db_key = None
        found_by = None
        path_needs_update = False
        if current_file_id:
            file_id_map = build_file_id_to_key_map(triggers_db)
            print(f"[DEBUG] File ID map has {len(file_id_map)} entries")
            if current_file_id in file_id_map:
                old_db_key = file_id_map[current_file_id]
                lora_data = triggers_db[old_db_key]
                found_by = "file_id"
                print(f"Loaded triggers by file_id: {current_file_id[:8]}... -> {old_db_key}")

                # Check if the path has changed (file was moved)
                instance = LoRaLoaderWithTriggerDB()
                current_normalized_path = instance.get_lora_base_name(lora_name)
                if old_db_key != current_normalized_path:
                    print(f"[PATH UPDATE] LoRa moved: {old_db_key} -> {current_normalized_path}")
                    # Update the database key to the new path
                    db_key = current_normalized_path
                    triggers_db[db_key] = lora_data
                    del triggers_db[old_db_key]
                    path_needs_update = True
                else:
                    db_key = old_db_key
            else:
                print(f"[DEBUG] File ID {current_file_id[:8]}... not found in map, trying path lookup")

        # Fall back to path-based lookup if file_id lookup failed
        if not lora_data:
            instance = LoRaLoaderWithTriggerDB()
            lora_data = instance.find_lora_in_db(triggers_db, lora_name)
            if lora_data:
                found_by = "path"
                # Get the actual key used in the database
                db_key = instance.get_lora_base_name(lora_name)
                has_file_id = "file_id" in lora_data if isinstance(lora_data, dict) else False
                print(f"Loaded triggers by path: {lora_name} (has_file_id: {has_file_id})")
            else:
                print(f"[DEBUG] No triggers found in database for: {lora_name}")

        # Handle both old format (string) and new format (dict)
        # Note: migration happens above, so this should mostly be dict format now
        if isinstance(lora_data, str):
            all_triggers = lora_data
            active_triggers = ""
        else:
            all_triggers = lora_data.get("all_triggers", "")
            active_triggers = lora_data.get("active_triggers", "")

        # Save database if path was updated
        if path_needs_update:
            try:
                with open(triggers_file, 'w', encoding='utf-8') as f:
                    json.dump(triggers_db, f, indent=2, ensure_ascii=False)
                print(f"[PATH UPDATE] Saved database with updated path")
            except Exception as e:
                print(f"Error saving updated path: {e}")

        return web.json_response({"all_triggers": all_triggers, "active_triggers": active_triggers})
        
    except Exception as e:
        print(f"Error in load_lora_triggers: {e}")
        return web.json_response({"all_triggers": "", "active_triggers": ""}, status=500)


# API endpoint for saving triggers
@server.PromptServer.instance.routes.post("/lora_triggers_save")
async def save_lora_triggers(request):
    try:
        data = await request.json()
        lora_name = data.get("lora_name", "")
        all_triggers = data.get("all_triggers", "")
        active_triggers = data.get("active_triggers", "")
        
        if not lora_name:
            return web.json_response({"success": False, "message": "No LoRa name provided"})
        
        # Get user database directory and triggers file
        user_db_path = get_user_db_path()
        triggers_file = os.path.join(user_db_path, "lora-triggers.json")
        
        # Load existing triggers database
        triggers_db = {}
        if os.path.exists(triggers_file):
            try:
                with open(triggers_file, 'r', encoding='utf-8') as f:
                    triggers_db = json.load(f)
            except (json.JSONDecodeError, Exception) as e:
                print(f"Error loading triggers.json: {e}")
        
        # Get full path to LoRa file and calculate file_id
        lora_path = folder_paths.get_full_path("loras", lora_name)
        file_id = None
        if lora_path and os.path.isfile(lora_path):
            file_id = get_file_id_safe(lora_path)

        # Save trigger words with normalized path
        instance = LoRaLoaderWithTriggerDB()
        lora_base_name = instance.get_lora_base_name(lora_name)  # This normalizes the path

        if all_triggers.strip() or active_triggers.strip():
            # Get existing entry or create a new dict if it doesn't exist
            # This preserves any custom fields added by external tools
            existing_entry = triggers_db.get(lora_base_name, {})

            # Handle old string format by converting to dict
            if isinstance(existing_entry, str):
                existing_entry = {
                    "all_triggers": existing_entry,
                    "active_triggers": ""
                }

            # Update only the fields we manage, preserving all other fields
            existing_entry["all_triggers"] = all_triggers.strip()
            existing_entry["active_triggers"] = active_triggers.strip()
            if file_id:
                existing_entry["file_id"] = file_id

            triggers_db[lora_base_name] = existing_entry

            # Save to file
            try:
                os.makedirs(os.path.dirname(triggers_file), exist_ok=True)
                with open(triggers_file, 'w', encoding='utf-8') as f:
                    json.dump(triggers_db, f, indent=2, ensure_ascii=False)

                file_id_msg = f" (file_id: {file_id})" if file_id else ""
                print(f"Saved triggers for {lora_base_name}{file_id_msg}: all='{all_triggers}', active='{active_triggers}'")
                return web.json_response({"success": True, "message": f"Saved triggers for {lora_base_name}"})
                
            except Exception as e:
                print(f"Error saving triggers.json: {e}")
                return web.json_response({"success": False, "message": f"Error saving: {e}"})
        else:
            return web.json_response({"success": False, "message": "No trigger words to save"})
        
    except Exception as e:
        print(f"Error in save_lora_triggers: {e}")
        return web.json_response({"success": False, "message": f"Error: {e}"}, status=500)


# API endpoint for loading metadata
@server.PromptServer.instance.routes.post("/lora_metadata")
async def load_lora_metadata(request):
    try:
        data = await request.json()
        lora_name = data.get("lora_name", "")
        
        if not lora_name:
            return web.json_response({"success": False, "message": "No LoRa name provided"})
        
        # Get full path to LoRa file
        lora_path = folder_paths.get_full_path("loras", lora_name)
        
        if not os.path.isfile(lora_path):
            return web.json_response({"success": False, "message": f"LoRa file not found: {lora_name}"})
        
        # Read metadata from LoRa file
        meta = read_lora_metadata(lora_path)
        
        if not meta:
            return web.json_response({"success": False, "message": "No metadata found in LoRa file"})
        
        # Extract trigger words from metadata
        triggers = extract_triggers_from_metadata(meta)
        
        if not triggers:
            return web.json_response({"success": False, "message": "No trigger words found in metadata"})
        
        # Clean trigger words
        cleaned_triggers = []
        for trigger in triggers:
            cleaned = clean_trigger_word(trigger)
            if cleaned and cleaned not in cleaned_triggers:  # Remove duplicates and None values
                cleaned_triggers.append(cleaned)
        
        if not cleaned_triggers:
            return web.json_response({"success": False, "message": "No valid trigger words found after cleaning"})
        
        # Join triggers with commas
        all_triggers = ", ".join(cleaned_triggers)
        
        # For active triggers, use the same as all triggers initially
        active_triggers = all_triggers
        
        return web.json_response({
            "success": True,
            "all_triggers": all_triggers,
            "active_triggers": active_triggers,
            "message": f"Loaded {len(cleaned_triggers)} trigger words from metadata"
        })
        
    except Exception as e:
        print(f"Error in load_lora_metadata: {e}")
        return web.json_response({"success": False, "message": f"Error loading metadata: {e}"}, status=500)


NODE_CLASS_MAPPINGS = {
    "LoRaLoaderWithTriggerDB": LoRaLoaderWithTriggerDB
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoRaLoaderWithTriggerDB": "LoRa Loader with Trigger DB"
}