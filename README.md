# LoRa Loader with Trigger Database

A ComfyUI custom node that provides a LoRa loader with persistent trigger word storage. Automatically saves and loads trigger words for each LoRa model, making your workflow more efficient.

> **Note:** This node is designed to be used in conjunction with a prompt combiner node such as **CR Combine Prompt**. Use this node to manage and store trigger words, then connect its outputs to a prompt combiner to build your final prompt for generation.

## Features

- **Dual Trigger Fields**: Separate "All Triggers" and "Active Triggers" text fields
- **Auto-loading**: Automatically loads saved triggers when selecting a LoRa
- **Load/Save Buttons**: Explicit buttons for loading and saving trigger words
- **Load Metadata Button**: Attempts to extract trigger words directly from the LoRa file's metadata (see below)
- **Persistent Database**: Stores trigger words in JSON format between sessions in `user/default/user-db/lora-triggers.json` in your ComfyUI directory
- **Stores all/active triggers**: Can be used to store all the triggers but also just the one you're currently using

## Load Metadata Button

The **"🔍 Load Metadata"** button tries to automatically extract trigger words from the selected LoRa file's metadata. If the LoRa was trained with tools like Kohya or includes trigger word information in its metadata, this button will populate the "All Triggers" and "Active Triggers" fields with those words.

- **How it works:**
  - Reads the LoRa file's metadata and looks for common keys such as `trained_words`, `ss_tag_strings`, `ss_tag_frequency`, or any key containing "trigger" or "word".
  - Cleans and deduplicates the extracted words, then fills both trigger fields.
- **Limitations:**
  - This feature only works if the LoRa file actually contains trigger word metadata. Not all LoRas include this information—especially older or manually edited files.
  - If no trigger words are found, the fields will remain unchanged and a message will be logged.

## Screenshot

LoRa loader with Trigger DB being used to apply triggers as part of a combination prompt with CR Combine Prompt:

![image](https://github.com/user-attachments/assets/e9a8fca0-e33c-4785-8b54-1c31f9b25518)

## Installation

### Method 1: ComfyUI Manager (Recommended)
1. Install via ComfyUI Manager using this Git URL:
   ```
   https://github.com/benstaniford/comfy-lora-loader-with-triggerdb
   ```

### Method 2: Manual Installation
1. Clone into your ComfyUI custom_nodes folder:
   ```bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/benstaniford/comfy-lora-loader-with-triggerdb.git
   ```
2. Restart ComfyUI

## Usage

1. Add the "LoRa Loader with Trigger DB" node from the "loaders" category
2. Select a LoRa from the dropdown - triggers auto-load if fields are empty
3. Use "All Triggers" for comprehensive trigger words, "Active Triggers" for current selection
4. Click "📥 Load Triggers" to load saved data or "💾 Save Triggers" to save current data
5. Click "🔍 Load Metadata" to attempt to extract trigger words directly from the LoRa file's metadata
6. Connect outputs to your workflow

## Node Details

**Inputs:**
- `model`: Base model to apply LoRa to
- `lora_name`: LoRa selection dropdown  
- `strength_model`: LoRa strength value (-20.0 to 20.0)
- `all_triggers`: Text field for all available trigger words
- `active_triggers`: Text field for currently active trigger words
- `clip`: (Optional) CLIP model input

**Outputs:**
- `model`: Model with LoRa applied
- `clip`: CLIP with LoRa applied  
- `all_triggers`: All triggers as string output
- `active_triggers`: Active triggers as string output

## Database

Trigger words are stored in `user/default/user-db/lora-triggers.json` in your ComfyUI directory:

```json
{
  "lora_name": {
    "all_triggers": "masterpiece, best quality, detailed",
    "active_triggers": "masterpiece, best quality",
    "file_id": "abc123def456..."
  }
}
```

**Key Features:**
- **Content-based tracking**: Each LoRa is tracked by its file content ID, so triggers persist even if you rename or move the file
- **Automatic migration**: The database automatically handles older formats and adds file IDs when you save triggers
- **Cross-platform compatible**: Works consistently across Windows, Linux, and Mac

The database file is created automatically and handles migration from older formats.

## License

This project is licensed under the same license as specified in the LICENSE file.
