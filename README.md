# LoRa Loader with Trigger Database

A ComfyUI custom node that provides a LoRa loader with automatic storage and retrieval of trigger words. This node maintains a database of trigger words associated with each LoRa model, making it easy to remember and reuse the appropriate trigger words for your LoRa models.

## Features

- **Searchable LoRa Dropdown**: Browse and select from all LoRa models in your ComfyUI loras folder
- **Automatic Trigger Loading**: When you select a LoRa, the node automatically loads any previously saved trigger words (if the trigger field is empty)
- **Load Triggers Button**: Explicitly load saved trigger words for the selected LoRa model
- **Save Triggers Button**: Save the current trigger words to the database for the selected LoRa model
- **Manual Override**: You can always manually edit trigger words in the text field
- **Persistent Storage**: Trigger words are stored in a JSON database that persists between sessions

## Installation

1. Clone this repository into your ComfyUI custom_nodes folder:
   ```bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/your-username/comfy-lora-loader-with-triggerdb.git
   ```

2. Restart ComfyUI

3. The node will appear under the "loaders" category as "LoRa Loader with Trigger DB"

## Usage

1. **Select a LoRa**: Use the dropdown to select a LoRa model from your collection
2. **Auto-load Triggers**: If the trigger words field is empty and trigger words have been previously saved for this LoRa, they will automatically load
3. **Load Triggers Button**: Click the "📥 Load Triggers" button to explicitly load saved trigger words for the selected LoRa
4. **Edit Trigger Words**: Modify the trigger words in the text field as needed
5. **Save Triggers Button**: Click the "💾 Save Triggers" button to save the current trigger words to the database
6. **Connect Model**: Connect your model input and use the model output in your workflow

## Inputs

- **model**: The base model to apply the LoRa to
- **lora_name**: Dropdown selection of available LoRa models
- **strength_model**: Model strength (default: 1.0, range: -20.0 to 20.0)
- **strength_clip**: CLIP strength (default: 1.0, range: -20.0 to 20.0)
- **trigger_words**: Text field for trigger words (multiline supported)
- **clip**: (Optional) CLIP model input

## Interface Elements

- **📥 Load Triggers Button**: Loads saved trigger words for the selected LoRa model
- **💾 Save Triggers Button**: Saves the current trigger words to the database

## Outputs

- **model**: The model with LoRa applied
- **clip**: The CLIP model with LoRa applied
- **trigger_words**: The trigger words as a string (can be connected to prompt nodes)

## Database

The trigger words are stored in a file called `triggers.json` in your ComfyUI loras folder. The file structure is:

```json
{
  "lora_model_name": "trigger words for this model",
  "another_lora": "different trigger words"
}
```

The file is created automatically when you first save trigger words for a LoRa model.

## Technical Details

- The node uses the base filename (without extension) as the key for storing trigger words
- The database file is automatically created if it doesn't exist
- Error handling ensures the node continues to work even if the database file is corrupted
- The web interface automatically loads trigger words when the LoRa selection changes

## License

This project is licensed under the same license as specified in the LICENSE file.
