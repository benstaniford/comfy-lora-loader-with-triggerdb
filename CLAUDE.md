# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

A ComfyUI custom node that provides a LoRa loader with persistent trigger word storage. The node automatically saves and loads trigger words for LoRa models, with support for metadata extraction from LoRa files.

## Architecture

### Core Components

**Python Backend** (`lora_loader_with_triggerdb.py`):
- `LoRaLoaderWithTriggerDB`: Main ComfyUI node class that loads LoRa models and applies them to base models
- `get_user_db_path()`: Determines database storage location in `user/default/user-db/` (with fallback to legacy LoRa folder)
- `read_lora_metadata()`: Reads metadata from `.safetensors`, `.pt`, or `.bin` LoRa files
- `extract_triggers_from_metadata()`: Extracts trigger words from metadata keys like `ss_tag_frequency`, `ss_tag_strings`, `trained_words`
- `clean_trigger_word()`: Cleans extracted triggers (removes leading numbers/underscores, filters unwanted words)

**API Endpoints** (served via ComfyUI's aiohttp server):
- `/lora_triggers` (POST): Load saved trigger words for a LoRa model
- `/lora_triggers_save` (POST): Save trigger words to the database
- `/lora_metadata` (POST): Extract trigger words from LoRa file metadata

**JavaScript Frontend** (`web/lora_loader_with_triggerdb.js`):
- Extends ComfyUI node with custom widgets (buttons for Load Triggers, Load Metadata, Save Triggers)
- Auto-loads saved triggers when LoRa selection changes (with 500ms debounce)
- Handles widget callbacks to preserve ComfyUI's native filtering behavior

**Module Entry** (`__init__.py`):
- Exports node mappings and sets web directory for ComfyUI integration

**File ID Utilities** (`file_id.py`):
- `get_file_id(filepath)`: Generates fast SHA1 hash ID for files by sampling first 1MB, last 1MB, and file size
- `get_file_id_safe(filepath, fallback)`: Safe wrapper with error handling that returns fallback on failure
- Designed for large LoRa files (multi-GB) to avoid reading entire file content
- Can be used as alternative database key instead of file paths for better reliability across file moves/renames

### Database Storage

**Location**: `{ComfyUI_root}/user/default/user-db/lora-triggers.json`

**Schema** (Current):
```json
{
  "subfolder/lora_name": {
    "all_triggers": "comprehensive, list, of, triggers",
    "active_triggers": "subset, of, triggers",
    "file_id": "abc123def456..."
  }
}
```

**Legacy Formats** (Backward Compatible):
```json
{
  "old_model": "trigger words as string",
  "legacy_model": {
    "all_triggers": "triggers",
    "active_triggers": "triggers"
  }
}
```

**Lookup Strategy**:
1. **File ID-based lookup (primary)**: If the LoRa file has a `file_id` in the database, lookup uses content-based matching (survives file moves/renames)
   - **Path correction**: If found by file_id but the path has changed (file was moved), the database key is automatically updated to the new path
2. **Path-based lookup (fallback)**: If no `file_id` is found, falls back to path matching with cross-platform normalization
3. **Auto-migration on save**: When triggers are saved, `file_id` is automatically added to the entry
4. **Global auto-migration on load**: When ANY LoRa is loaded, scans the entire database and upgrades ALL entries missing file_ids:
   - If the file exists: Calculates and adds the real `file_id`
   - If the file is missing: Marks the entry with `file_id: "unknown"`
   - Database is saved once after all migrations complete
   - Migration happens once, subsequent loads use the file_ids

**Cross-Platform Key Normalization**:
- All LoRa paths use forward slashes (`/`) for consistent key matching across Windows/Linux/Mac
- Database keys are relative paths from the LoRa folder (e.g., `flux/my-lora`, not absolute paths)
- Keys stored without file extensions (e.g., `subfolder/model` not `subfolder/model.safetensors`)
- Database lookup handles both exact matches and normalized path comparisons
- File IDs provide additional robustness against path changes
- When a LoRa is moved, the database key is automatically updated to match the new location

## Development Patterns

### Node Implementation
- ComfyUI nodes must define `INPUT_TYPES` classmethod and `RETURN_TYPES`/`RETURN_NAMES` class attributes
- The function name in `FUNCTION` attribute must match a method that processes inputs
- Widget additions in JavaScript use `this.addWidget(type, label, value, callback, options)`
- `{ serialize: false }` option prevents button state from being saved in workflows

### API Integration
- Register routes via `@server.PromptServer.instance.routes.post(path)`
- Frontend uses `api.fetchApi(endpoint, options)` imported from ComfyUI's API module
- All database operations handle migration from old string format to new dict format with `all_triggers`/`active_triggers`

### Metadata Extraction
- Supports `.safetensors` (preferred), `.pt`, and `.bin` formats
- Uses `safetensors.torch.safe_open()` for safetensors files
- Falls back to `torch.load()` for PyTorch checkpoint files
- Looks for common metadata keys used by Kohya and other training tools
- Cleans extracted words (removes dataset artifacts like `1_girl` → `girl`)

### Path Handling
- Use `folder_paths.get_folder_paths("loras")` to get LoRa directory
- Use `folder_paths.get_full_path("loras", filename)` to resolve full path
- Always normalize paths with forward slashes for database keys
- Handle subfolders properly (LoRa files can be in nested directories)

### File ID Generation
- Import with `from file_id import get_file_id, get_file_id_safe`
- File IDs are content-based hashes (SHA1 of size + first/last 1MB)
- Much faster than full file hashing for multi-GB LoRa files
- Potential use cases:
  - Alternative database keys (more stable than file paths)
  - Detecting duplicate LoRa files with different names
  - Tracking LoRa files across directory reorganizations
- Use `get_file_id_safe()` when you need graceful error handling

## Testing the Node

Since this is a ComfyUI custom node, testing requires a running ComfyUI instance:

1. Install in ComfyUI's `custom_nodes` directory
2. Restart ComfyUI server
3. Add "LoRa Loader with Trigger DB" node from the "loaders" category
4. Verify:
   - LoRa selection dropdown populates
   - Buttons appear (📥 Load Triggers, 🔍 Load Metadata, 💾 Save Triggers)
   - Auto-loading works when switching LoRas
   - Database file created at `user/default/user-db/lora-triggers.json`
   - Metadata extraction works for files with embedded trigger words

## Key Implementation Details

### Auto-Loading Behavior
- Triggers auto-load when LoRa selection changes (both via dropdown change event and callback override)
- Dual approach ensures compatibility: DOM event listener + callback wrapper
- 500ms debounce prevents excessive API calls during typing/filtering
- Preserves ComfyUI's original filtering functionality by calling original callback first

### Database Migration
- Handles legacy format (string) → new format (dict with `all_triggers`/`active_triggers`)
- Migrates path separators to forward slashes for cross-platform compatibility
- Finds entries using normalized path matching even if stored with backslashes
- Automatically adds `file_id` to entries when triggers are saved
- File ID-based lookup uses `build_file_id_to_key_map()` helper to create reverse mapping
- Gracefully handles mixed database with entries both with and without file IDs

### Model Application
- Only applies LoRa to the model (not CLIP) via `comfy.sd.load_lora_for_models(model, None, lora, strength_model, 0)`
- Returns model with LoRa applied and passes through trigger strings unchanged
- Trigger strings are outputs for connecting to prompt combiner nodes
