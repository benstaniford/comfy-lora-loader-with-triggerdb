import os
import json
import folder_paths
import comfy.sd
import comfy.utils
from .file_id import get_file_id_safe


# ============================================================================
# Flexible Input Type Classes (based on rgthree pattern)
# ============================================================================

class AnyType(str):
    """A special class that is always equal in not equal comparisons."""
    def __ne__(self, __value: object) -> bool:
        return False


any_type = AnyType("*")


class FlexibleOptionalInputType(dict):
    """
    A special class to enable dynamic number of inputs (like rgthree Power Lora Loader).

    This tells ComfyUI that our node will handle any input, regardless of what it is.
    """

    def __init__(self, type):
        self.type = type
        # Predefined optional inputs
        self["model"] = ("MODEL",)
        self["clip"] = ("CLIP",)

    def __getitem__(self, key):
        # If we have this key in predefined inputs, return it
        if key in ["model", "clip"]:
            return super().__getitem__(key)
        # Otherwise return the flexible type tuple
        return (self.type,)

    def __contains__(self, key):
        # Always contain any key, so ComfyUI will pass it to us
        return True


# ============================================================================
# Utility Functions (copied from lora_loader_with_triggerdb.py)
# ============================================================================

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


def get_lora_base_name(lora_name):
    """Get the base name of the LoRa file (without extension), normalized"""
    normalized_name = lora_name.replace("\\", "/")
    return os.path.splitext(normalized_name)[0]


def find_lora_in_db(triggers_db, lora_name):
    """
    Find trigger data for a LoRa using path-based lookup with normalization.

    Args:
        triggers_db: The triggers database dictionary
        lora_name: The LoRa file name

    Returns:
        dict or str: Trigger data if found, None otherwise
    """
    current_key = get_lora_base_name(lora_name)

    # Try exact match
    if current_key in triggers_db:
        return triggers_db[current_key]

    # Try normalized matching
    current_normalized = current_key.replace("\\", "/")
    for stored_key, stored_data in triggers_db.items():
        stored_normalized = stored_key.replace("\\", "/")
        if stored_normalized == current_normalized:
            return stored_data

    return None


def load_triggers_for_lora(lora_name, lora_path, triggers_file):
    """
    Load trigger data for a specific LoRa from the database.

    Args:
        lora_name: The LoRa file name
        lora_path: Full path to the LoRa file
        triggers_file: Path to the triggers database JSON file

    Returns:
        dict: Dictionary with 'all_triggers' and 'active_triggers' keys
    """
    # Load database
    triggers_db = {}
    if os.path.exists(triggers_file):
        try:
            with open(triggers_file, 'r', encoding='utf-8') as f:
                triggers_db = json.load(f)
        except (json.JSONDecodeError, Exception) as e:
            print(f"Error loading triggers.json: {e}")
            return {"all_triggers": "", "active_triggers": ""}

    lora_data = {}

    # Try file_id-based lookup first if we have a path
    if lora_path and os.path.isfile(lora_path):
        current_file_id = get_file_id_safe(lora_path)
        if current_file_id:
            file_id_map = build_file_id_to_key_map(triggers_db)
            if current_file_id in file_id_map:
                db_key = file_id_map[current_file_id]
                lora_data = triggers_db[db_key]

    # Fall back to path-based lookup
    if not lora_data:
        lora_data = find_lora_in_db(triggers_db, lora_name)

    # Handle old string format
    if isinstance(lora_data, str):
        lora_data = {
            "all_triggers": lora_data,
            "active_triggers": ""
        }

    # Ensure we have a dict with the expected keys
    if not isinstance(lora_data, dict):
        lora_data = {}

    return {
        "all_triggers": lora_data.get("all_triggers", ""),
        "active_triggers": lora_data.get("active_triggers", "")
    }


# ============================================================================
# Main Node Class
# ============================================================================

class StackingLoRaLoaderWithTriggerDB:
    """
    A stacking LoRa loader that supports unlimited LoRa slots with automatic
    trigger word loading from the database.

    Inspired by rgthree's Power Lora Loader pattern.
    """

    def __init__(self):
        self.user_db_path = get_user_db_path()
        self.triggers_file = os.path.join(self.user_db_path, "lora-triggers.json")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": FlexibleOptionalInputType(any_type),
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("model", "clip", "combined_triggers")
    FUNCTION = "apply_loras"
    CATEGORY = "loaders"

    def apply_loras(self, model=None, clip=None, **kwargs):
        """
        Apply multiple LoRas sequentially based on dynamic inputs.

        Args:
            model: Base MODEL input (optional)
            clip: Base CLIP input (optional)
            **kwargs: Dynamic lora_1, lora_2, ... lora_N inputs
                     Each value is a dict: {"on": bool, "lora": str, "strength": float, "triggers": str}

        Returns:
            tuple: (modified_model, modified_clip, combined_triggers_string)
        """
        # Collect all lora_* inputs and sort by index
        lora_inputs = []
        for key, value in kwargs.items():
            key_upper = key.upper()
            if key_upper.startswith("LORA_"):
                try:
                    # Extract index from lora_1, lora_2, etc.
                    index = int(key.split("_")[1])
                    lora_inputs.append((index, value))
                except (IndexError, ValueError):
                    # Skip malformed keys
                    continue

        # Sort by index to maintain order
        lora_inputs.sort(key=lambda x: x[0])

        # Initialize outputs (don't clone yet, do it only if we need to apply loras)
        current_model = model
        current_clip = clip
        all_triggers = []

        # Track if we've cloned yet
        has_cloned = False

        # Process each LoRa sequentially
        for index, lora_data in lora_inputs:
            # lora_data should be a dict: {"on": bool, "lora": str, "strength": float, "triggers": str}
            if not isinstance(lora_data, dict):
                print(f"Warning: lora_{index} has invalid data format (expected dict, got {type(lora_data).__name__})")
                continue

            # Extract values
            is_enabled = lora_data.get("on", False)
            lora_name = lora_data.get("lora", "")
            strength = lora_data.get("strength", 1.0)
            triggers = lora_data.get("triggers", "")

            # Skip if disabled or no LoRa selected
            if not is_enabled:
                continue

            if not lora_name or lora_name.strip() == "":
                continue

            # Skip if strength is zero (no effect)
            try:
                strength = float(strength)
                # Clamp strength to valid range
                strength = max(-20.0, min(20.0, strength))
                if strength == 0:
                    continue
            except (ValueError, TypeError):
                print(f"Warning: Invalid strength value for lora_{index}: {strength}, using 1.0")
                strength = 1.0

            # Get full path to LoRa file
            lora_path = folder_paths.get_full_path("loras", lora_name)
            if not lora_path:
                print(f"Warning: LoRa not found in paths: {lora_name}")
                continue

            if not os.path.isfile(lora_path):
                print(f"Warning: LoRa file does not exist: {lora_path}")
                continue

            # Load LoRa file
            try:
                lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                if lora is None:
                    print(f"Warning: Failed to load LoRa (returned None): {lora_name}")
                    continue
            except Exception as e:
                print(f"Error loading LoRa {lora_name}: {e}")
                continue

            # Clone model and clip on first LoRa application
            if not has_cloned:
                if current_model is not None:
                    current_model = current_model.clone()
                if current_clip is not None:
                    current_clip = current_clip.clone()
                has_cloned = True

            # Apply LoRa to model and CLIP
            try:
                if current_model is not None:
                    current_model, current_clip = comfy.sd.load_lora_for_models(
                        current_model,
                        current_clip,
                        lora,
                        strength,  # strength_model
                        strength   # strength_clip (same value)
                    )
                    print(f"Applied LoRa {index}: {lora_name} (strength: {strength})")
                else:
                    print(f"Warning: No model provided, skipping LoRa {index}: {lora_name}")
            except Exception as e:
                print(f"Error applying LoRa {lora_name}: {e}")
                continue

            # Collect triggers if present
            if triggers and triggers.strip():
                all_triggers.append(triggers.strip())

        # Combine all triggers as comma-separated string
        combined_triggers = ", ".join(all_triggers) if all_triggers else ""

        # Return modified model/clip and combined triggers
        return (current_model, current_clip, combined_triggers)


# ============================================================================
# Node Registration
# ============================================================================

NODE_CLASS_MAPPINGS = {
    "StackingLoRaLoaderWithTriggerDB": StackingLoRaLoaderWithTriggerDB
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "StackingLoRaLoaderWithTriggerDB": "Stacking LoRa Loader with Trigger DB"
}
