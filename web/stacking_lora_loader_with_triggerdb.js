import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Extension for Stacking LoRa Loader with Trigger DB
app.registerExtension({
    name: "StackingLoRaLoaderWithTriggerDB",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "StackingLoRaLoaderWithTriggerDB") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;

            nodeType.prototype.onNodeCreated = function() {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

                // Initialize slot management
                this.loraSlots = [];
                this.slotCounter = 0;

                // Add initial LoRa slots (start with 3)
                for (let i = 0; i < 3; i++) {
                    this.addLoraSlot();
                }

                // Add "Add LoRa Slot" button at the bottom
                this.addWidget("button", "➕ Add LoRa Slot", null, () => {
                    this.addLoraSlot();
                }, { serialize: false });

                // Force node to recalculate size
                this.setSize(this.computeSize());

                return r;
            };

            /**
             * Add a new LoRa slot with all its widgets
             */
            nodeType.prototype.addLoraSlot = function() {
                const slotIndex = ++this.slotCounter;

                // Get available LoRas
                const loras = this.getLoraList();

                // Create slot data structure
                const slotData = {
                    index: slotIndex,
                    enabled: true,
                    lora: "",
                    strength: 1.0,
                    triggers: ""
                };

                this.loraSlots.push(slotData);

                // 1. Toggle widget (checkbox-style)
                const toggleWidget = this.addWidget(
                    "toggle",
                    `☑️ LoRa ${slotIndex}`,
                    slotData.enabled,
                    (value) => {
                        slotData.enabled = value;
                        // Update the visual state of related widgets
                        this.updateSlotVisibility(slotData);
                    },
                    { serialize: false }  // Don't serialize, will be in slot data
                );
                slotData.toggleWidget = toggleWidget;

                // 2. LoRa selector dropdown
                const loraWidget = this.addWidget(
                    "combo",
                    `lora_${slotIndex}`,
                    slotData.lora,
                    (value) => {
                        slotData.lora = value;
                        // Auto-load triggers when LoRa changes
                        this.loadTriggersForSlot(slotData);
                    },
                    { values: loras }
                );
                slotData.loraWidget = loraWidget;

                // 3. Strength slider
                const strengthWidget = this.addWidget(
                    "number",
                    `  Strength`,
                    slotData.strength,
                    (value) => {
                        slotData.strength = value;
                    },
                    { min: -20.0, max: 20.0, step: 0.01, precision: 2 }
                );
                slotData.strengthWidget = strengthWidget;

                // 4. Triggers display (read-only text)
                const triggersWidget = this.addWidget(
                    "text",
                    `  Triggers`,
                    slotData.triggers || "(no triggers)",
                    null,  // No callback for read-only
                    { multiline: false }
                );
                // Make it read-only by disabling input if possible
                if (triggersWidget.inputEl) {
                    triggersWidget.inputEl.readOnly = true;
                    triggersWidget.inputEl.style.opacity = "0.7";
                }
                slotData.triggersWidget = triggersWidget;

                // Store widget references
                slotData.widgets = [toggleWidget, loraWidget, strengthWidget, triggersWidget];

                // Force node to recalculate size
                this.setSize(this.computeSize());

                return slotData;
            };

            /**
             * Get the list of available LoRa files
             */
            nodeType.prototype.getLoraList = function() {
                // Try to get LoRa list from ComfyUI
                try {
                    // Check if there's a widget definition we can use
                    const loraInput = nodeData?.input?.optional?.lora_1;
                    if (loraInput && Array.isArray(loraInput[0])) {
                        return loraInput[0];
                    }
                } catch (e) {
                    console.log("Could not get LoRa list from node data:", e);
                }

                // Fallback to empty array (ComfyUI will populate it)
                return [];
            };

            /**
             * Load triggers from database for a specific slot
             */
            nodeType.prototype.loadTriggersForSlot = async function(slotData) {
                const loraName = slotData.lora;

                // Clear triggers if no LoRa selected
                if (!loraName || loraName.trim() === "") {
                    slotData.triggers = "";
                    if (slotData.triggersWidget) {
                        slotData.triggersWidget.value = "(no LoRa selected)";
                    }
                    return;
                }

                // Show loading state
                if (slotData.triggersWidget) {
                    slotData.triggersWidget.value = "Loading...";
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

                        if (slotData.triggersWidget) {
                            if (triggers) {
                                slotData.triggersWidget.value = triggers;
                                // Set title for tooltip with full text
                                if (slotData.triggersWidget.inputEl) {
                                    slotData.triggersWidget.inputEl.title = triggers;
                                }
                            } else {
                                slotData.triggersWidget.value = "(no triggers saved)";
                            }
                        }
                    } else {
                        slotData.triggers = "";
                        if (slotData.triggersWidget) {
                            slotData.triggersWidget.value = "(error loading)";
                        }
                    }
                } catch (error) {
                    console.error(`Error loading triggers for slot ${slotData.index}:`, error);
                    slotData.triggers = "";
                    if (slotData.triggersWidget) {
                        slotData.triggersWidget.value = "(error loading)";
                    }
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
             * Get the current widget values and prepare them for backend processing
             */
            nodeType.prototype.getExtraMenuOptions = function(_, options) {
                options.push({
                    content: "🗑️ Clear Empty Slots",
                    callback: () => {
                        this.clearEmptySlots();
                    }
                });
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
             * Override getInputData to provide slot data to backend
             */
            const originalGetInputData = nodeType.prototype.getInputData;
            nodeType.prototype.getInputData = function() {
                const data = originalGetInputData ? originalGetInputData.apply(this, arguments) : {};

                // Add lora slot data to inputs
                this.loraSlots.forEach((slot) => {
                    const key = `lora_${slot.index}`;
                    data[key] = {
                        on: slot.enabled,
                        lora: slot.lora || "",
                        strength: slot.strength,
                        triggers: slot.triggers || ""
                    };
                });

                return data;
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
            nodeType.prototype.configure = function(data) {
                // Restore basic configuration first
                if (originalConfigure) {
                    originalConfigure.apply(this, arguments);
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
                        slot.triggers = slotInfo.triggers;

                        // Update widget values
                        if (slot.toggleWidget) slot.toggleWidget.value = slot.enabled;
                        if (slot.loraWidget) slot.loraWidget.value = slot.lora;
                        if (slot.strengthWidget) slot.strengthWidget.value = slot.strength;
                        if (slot.triggersWidget) {
                            slot.triggersWidget.value = slot.triggers || "(no triggers)";
                        }

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
