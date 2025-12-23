import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Extension for Stacking LoRa Loader with Trigger DB
app.registerExtension({
    name: "StackingLoRaLoaderWithTriggerDB",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "StackingLoRaLoaderWithTriggerDB") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;

            nodeType.prototype.onNodeCreated = async function() {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

                // Initialize slot management - always start fresh
                this.loraSlots = [];
                this.slotCounter = 0;
                this.loraList = [];

                // Fetch lora list once
                this.loraList = await this.getLoraList();

                // Add "Add LoRa Slot" button first (it will stay at the bottom)
                this.addLoraButton = this.addWidget("button", "➕ Add LoRa Slot", null, () => {
                    this.addLoraSlot();
                }, { serialize: false });

                // Add initial LoRa slots (start with 1 empty slot)
                this.addLoraSlot();

                // Force node to recalculate size
                this.setSize(this.computeSize());

                return r;
            };

            /**
             * Add a new LoRa slot with all its widgets
             */
            nodeType.prototype.addLoraSlot = function() {
                const slotIndex = ++this.slotCounter;

                // Create slot data structure
                const slotData = {
                    index: slotIndex,
                    enabled: true,
                    lora: "",
                    strength: 1.0,
                    triggers: ""  // Internal only, not displayed
                };

                this.loraSlots.push(slotData);

                // Get the position to insert (before the add button)
                const addButtonIndex = this.widgets.indexOf(this.addLoraButton);

                // 1. Toggle widget (checkbox-style)
                const toggleWidget = this.addWidget(
                    "toggle",
                    `LoRa ${slotIndex}`,
                    slotData.enabled,
                    (value) => {
                        slotData.enabled = value;
                        this.updateSlotVisibility(slotData);
                    },
                    { serialize: false }
                );
                slotData.toggleWidget = toggleWidget;

                // Move toggle before add button
                if (addButtonIndex !== -1) {
                    this.widgets.splice(this.widgets.indexOf(toggleWidget), 1);
                    this.widgets.splice(addButtonIndex, 0, toggleWidget);
                }

                // 2. LoRa selector dropdown
                const loraWidget = this.addWidget(
                    "combo",
                    `lora_${slotIndex}`,
                    slotData.lora,
                    (value) => {
                        slotData.lora = value;
                        this.loadTriggersForSlot(slotData);
                    },
                    { values: this.loraList || [] }
                );
                slotData.loraWidget = loraWidget;

                // Move lora before add button
                if (addButtonIndex !== -1) {
                    this.widgets.splice(this.widgets.indexOf(loraWidget), 1);
                    this.widgets.splice(this.widgets.indexOf(this.addLoraButton), 0, loraWidget);
                }

                // 3. Strength slider
                const strengthWidget = this.addWidget(
                    "number",
                    `  strength`,  // Simple label, indent for visual grouping
                    slotData.strength,
                    (value) => {
                        slotData.strength = value;
                    },
                    { min: -20.0, max: 20.0, step: 0.01, precision: 2 }
                );
                // Note: widget name is just "  strength" for display, but we track it via slotData
                slotData.strengthWidget = strengthWidget;

                // Move strength before add button
                if (addButtonIndex !== -1) {
                    this.widgets.splice(this.widgets.indexOf(strengthWidget), 1);
                    this.widgets.splice(this.widgets.indexOf(this.addLoraButton), 0, strengthWidget);
                }

                // Store widget references (no triggers widget visible)
                slotData.widgets = [toggleWidget, loraWidget, strengthWidget];

                // Force node to recalculate size
                this.setSize(this.computeSize());

                return slotData;
            };

            /**
             * Get the list of available LoRa files from ComfyUI
             */
            nodeType.prototype.getLoraList = async function() {
                try {
                    // Fetch lora list from ComfyUI's object_info API
                    const response = await api.fetchApi("/object_info");
                    if (response.ok) {
                        const objectInfo = await response.json();
                        // Look for any node that has lora inputs to get the list
                        for (const nodeInfo of Object.values(objectInfo)) {
                            if (nodeInfo.input && nodeInfo.input.required) {
                                for (const [inputName, inputDef] of Object.entries(nodeInfo.input.required)) {
                                    if (inputName.includes("lora") && Array.isArray(inputDef) && Array.isArray(inputDef[0])) {
                                        return inputDef[0];
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.log("Could not fetch LoRa list:", e);
                }
                return [];
            };

            /**
             * Load triggers from database for a specific slot (internal only, not displayed)
             */
            nodeType.prototype.loadTriggersForSlot = async function(slotData) {
                const loraName = slotData.lora;

                // Clear triggers if no LoRa selected
                if (!loraName || loraName.trim() === "") {
                    slotData.triggers = "";
                    return;
                }

                try {
                    const response = await api.fetchApi("/lora_triggers", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            lora_name: loraName
                        })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        // Use active_triggers (user's selection) or fall back to all_triggers
                        const triggers = data.active_triggers || data.all_triggers || "";
                        slotData.triggers = triggers;
                        console.log(`Loaded triggers for ${loraName}: ${triggers.substring(0, 50)}${triggers.length > 50 ? '...' : ''}`);
                    } else {
                        slotData.triggers = "";
                    }
                } catch (error) {
                    console.error(`Error loading triggers for slot ${slotData.index}:`, error);
                    slotData.triggers = "";
                }
            };

            /**
             * Update visual state of slot widgets based on enabled state
             */
            nodeType.prototype.updateSlotVisibility = function(slotData) {
                const isEnabled = slotData.enabled;

                // Update opacity of widgets when disabled
                if (slotData.widgets) {
                    slotData.widgets.forEach((widget, idx) => {
                        if (idx > 0 && widget.inputEl) {  // Skip toggle widget itself
                            widget.inputEl.style.opacity = isEnabled ? "1.0" : "0.5";
                        }
                    });
                }
            };

            /**
             * Get context menu options - both node-level and widget-level
             */
            nodeType.prototype.getExtraMenuOptions = function(_, options) {
                // Check if we're over a specific widget
                const canvas = app.canvas;
                const mousePos = canvas.graph_mouse;
                let clickedSlot = null;

                // Find which slot was clicked based on mouse position
                if (mousePos && this.widgets) {
                    for (const slot of this.loraSlots || []) {
                        // Check if mouse is over any of this slot's widgets
                        for (const widget of slot.widgets) {
                            const widgetIndex = this.widgets.indexOf(widget);
                            if (widgetIndex !== -1 && widget.last_y !== undefined) {
                                const widgetY = this.pos[1] + widget.last_y;
                                const widgetHeight = widget.computedHeight || 30;
                                if (mousePos[1] >= widgetY && mousePos[1] <= widgetY + widgetHeight) {
                                    clickedSlot = slot;
                                    break;
                                }
                            }
                        }
                        if (clickedSlot) break;
                    }
                }

                // If we clicked on a specific slot, add slot-specific options
                if (clickedSlot) {
                    const slotIndex = this.loraSlots.indexOf(clickedSlot);

                    // Remove this LoRa
                    options.push({
                        content: "🗑️ Remove LoRa",
                        callback: () => {
                            this.removeLoraSlot(clickedSlot);
                        }
                    });

                    // Move up (if not first)
                    if (slotIndex > 0) {
                        options.push({
                            content: "⬆️ Move Up",
                            callback: () => {
                                this.moveLoraSlot(clickedSlot, -1);
                            }
                        });
                    }

                    // Move down (if not last)
                    if (slotIndex < this.loraSlots.length - 1) {
                        options.push({
                            content: "⬇️ Move Down",
                            callback: () => {
                                this.moveLoraSlot(clickedSlot, 1);
                            }
                        });
                    }

                    options.push(null); // Separator
                }

                // Always show clear empty slots option
                options.push({
                    content: "🗑️ Clear Empty Slots",
                    callback: () => {
                        this.clearEmptySlots();
                    }
                });
            };

            /**
             * Remove a specific LoRa slot
             */
            nodeType.prototype.removeLoraSlot = function(slotData) {
                // Find the slot in the array
                const slotIndex = this.loraSlots.indexOf(slotData);
                if (slotIndex === -1) return;

                // Remove the slot's widgets from the node
                if (slotData.widgets) {
                    slotData.widgets.forEach(widget => {
                        const widgetIndex = this.widgets.indexOf(widget);
                        if (widgetIndex !== -1) {
                            this.widgets.splice(widgetIndex, 1);
                        }
                    });
                }

                // Remove from slots array
                this.loraSlots.splice(slotIndex, 1);

                // Force node to recalculate size
                this.setSize(this.computeSize());

                console.log(`Removed LoRa slot ${slotData.index}`);
            };

            /**
             * Move a LoRa slot up or down
             */
            nodeType.prototype.moveLoraSlot = function(slotData, direction) {
                const slotIndex = this.loraSlots.indexOf(slotData);
                if (slotIndex === -1) return;

                const newIndex = slotIndex + direction;
                if (newIndex < 0 || newIndex >= this.loraSlots.length) return;

                // Swap in the slots array
                const temp = this.loraSlots[slotIndex];
                this.loraSlots[slotIndex] = this.loraSlots[newIndex];
                this.loraSlots[newIndex] = temp;

                // Move widgets in the widgets array
                // Each slot has 3 widgets (toggle, lora, strength)
                const slot1Widgets = this.loraSlots[slotIndex].widgets;
                const slot2Widgets = this.loraSlots[newIndex].widgets;

                // Find their positions in the widgets array
                const widget1StartIndex = this.widgets.indexOf(slot1Widgets[0]);
                const widget2StartIndex = this.widgets.indexOf(slot2Widgets[0]);

                // Remove both sets of widgets
                const widgets1 = this.widgets.splice(widget1StartIndex, 3);
                const widgets2 = this.widgets.splice(
                    widget2StartIndex > widget1StartIndex ? widget2StartIndex - 3 : widget2StartIndex,
                    3
                );

                // Re-insert them in swapped order
                if (widget1StartIndex < widget2StartIndex) {
                    this.widgets.splice(widget1StartIndex, 0, ...widgets2);
                    this.widgets.splice(widget2StartIndex, 0, ...widgets1);
                } else {
                    this.widgets.splice(widget2StartIndex, 0, ...widgets1);
                    this.widgets.splice(widget1StartIndex, 0, ...widgets2);
                }

                // Force node to recalculate size and redraw
                this.setSize(this.computeSize());
                this.setDirtyCanvas(true, true);

                console.log(`Moved LoRa slot ${slotData.index} ${direction > 0 ? 'down' : 'up'}`);
            };

            /**
             * Remove slots with no LoRa selected
             */
            nodeType.prototype.clearEmptySlots = function() {
                // Identify empty slots (no LoRa selected)
                const slotsToRemove = [];

                for (let i = this.loraSlots.length - 1; i >= 0; i--) {
                    const slot = this.loraSlots[i];
                    if (!slot.lora || slot.lora.trim() === "") {
                        // Keep at least one slot
                        if (this.loraSlots.length > 1) {
                            slotsToRemove.push(i);
                        }
                    }
                }

                // Remove the slots and their widgets
                for (const slotIndex of slotsToRemove) {
                    const slot = this.loraSlots[slotIndex];

                    // Remove widgets from node
                    if (slot.widgets) {
                        slot.widgets.forEach(widget => {
                            const widgetIndex = this.widgets.indexOf(widget);
                            if (widgetIndex !== -1) {
                                this.widgets.splice(widgetIndex, 1);
                            }
                        });
                    }

                    // Remove slot from array
                    this.loraSlots.splice(slotIndex, 1);
                }

                // Force node to recalculate size
                this.setSize(this.computeSize());

                console.log(`Cleared ${slotsToRemove.length} empty slots`);
            };

            /**
             * Override onSerialize - called when building prompt for execution
             * This is different from serialize() which is for saving workflows
             */
            const originalOnSerialize = nodeType.prototype.onSerialize;
            nodeType.prototype.onSerialize = function(o) {
                if (originalOnSerialize) {
                    originalOnSerialize.call(this, o);
                }

                // Ensure widgets_values exists
                if (!o.widgets_values) {
                    o.widgets_values = [];
                }

                // Replace each lora widget's value with a dict for execution
                for (const slot of this.loraSlots || []) {
                    const widgetIndex = this.widgets.indexOf(slot.loraWidget);
                    if (widgetIndex !== -1) {
                        o.widgets_values[widgetIndex] = {
                            on: slot.enabled,
                            lora: slot.lora || "",
                            strength: slot.strength,
                            triggers: slot.triggers || ""
                        };
                    }
                }
            };

            /**
             * Serialize node state for workflow save
             */
            const originalSerialize = nodeType.prototype.serialize;
            nodeType.prototype.serialize = function() {
                const data = originalSerialize ? originalSerialize.apply(this, arguments) : {};

                // Save slot states
                if (!data.widgets_values) {
                    data.widgets_values = [];
                }

                // Store slot data in a custom property
                data.lora_slots = this.loraSlots.map(slot => ({
                    index: slot.index,
                    enabled: slot.enabled,
                    lora: slot.lora,
                    strength: slot.strength,
                    triggers: slot.triggers
                }));

                data.slot_counter = this.slotCounter;

                return data;
            };

            /**
             * Deserialize node state when loading workflow
             */
            const originalConfigure = nodeType.prototype.configure;
            nodeType.prototype.configure = async function(data) {
                // Restore basic configuration first
                if (originalConfigure) {
                    originalConfigure.apply(this, arguments);
                }

                // Initialize if needed
                if (!this.loraList) {
                    this.loraList = await this.getLoraList();
                }

                // Restore slot data if available
                if (data.lora_slots && Array.isArray(data.lora_slots)) {
                    // Clear existing slots first
                    this.loraSlots = [];
                    this.slotCounter = data.slot_counter || 0;

                    // Remove all existing widgets except the "Add" button
                    const addButtonWidget = this.widgets.find(w => w.name === "➕ Add LoRa Slot");
                    this.widgets = addButtonWidget ? [addButtonWidget] : [];

                    // Recreate slots from saved data
                    data.lora_slots.forEach(slotInfo => {
                        this.slotCounter = slotInfo.index - 1;  // Set counter before adding
                        const slot = this.addLoraSlot();

                        // Restore slot data
                        slot.enabled = slotInfo.enabled;
                        slot.lora = slotInfo.lora;
                        slot.strength = slotInfo.strength;
                        slot.triggers = slotInfo.triggers || "";

                        // Update widget values
                        if (slot.toggleWidget) slot.toggleWidget.value = slot.enabled;
                        if (slot.loraWidget) slot.loraWidget.value = slot.lora;
                        if (slot.strengthWidget) slot.strengthWidget.value = slot.strength;

                        // Update visibility
                        this.updateSlotVisibility(slot);
                    });

                    // Move "Add" button to the end
                    if (addButtonWidget) {
                        const index = this.widgets.indexOf(addButtonWidget);
                        if (index !== -1 && index !== this.widgets.length - 1) {
                            this.widgets.splice(index, 1);
                            this.widgets.push(addButtonWidget);
                        }
                    }
                }

                // Force node to recalculate size
                this.setSize(this.computeSize());
            };
        }
    }
});
