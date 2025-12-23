import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

/**
 * Create and show a searchable dropdown for LoRa selection
 */
function showLoraSearchPopup(event, loraList, onSelect) {
    // Remove any existing popup
    const existingPopup = document.querySelector('.lora-search-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    // Create popup container
    const popup = document.createElement('div');
    popup.className = 'lora-search-popup';
    popup.style.cssText = `
        position: fixed;
        left: ${event.clientX}px;
        top: ${event.clientY}px;
        background: #353535;
        border: 1px solid #555;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        z-index: 10000;
        max-height: 400px;
        width: 300px;
        display: flex;
        flex-direction: column;
    `;

    // Create search input
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type to search...';
    input.style.cssText = `
        width: 100%;
        padding: 8px;
        border: none;
        border-bottom: 1px solid #555;
        background: #404040;
        color: #fff;
        font-size: 14px;
        box-sizing: border-box;
        outline: none;
    `;

    // Create results container
    const resultsContainer = document.createElement('div');
    resultsContainer.style.cssText = `
        overflow-y: auto;
        max-height: 350px;
    `;

    // Function to render results
    function renderResults(filter) {
        resultsContainer.innerHTML = '';
        const filterLower = filter.toLowerCase();
        const filtered = loraList.filter(l => l.toLowerCase().includes(filterLower));

        if (filtered.length === 0) {
            const noResults = document.createElement('div');
            noResults.textContent = 'No matches found';
            noResults.style.cssText = 'padding: 8px; color: #888; font-style: italic;';
            resultsContainer.appendChild(noResults);
            return;
        }

        filtered.slice(0, 50).forEach((lora, index) => {
            const item = document.createElement('div');
            item.textContent = lora;
            item.style.cssText = `
                padding: 6px 8px;
                cursor: pointer;
                color: #ddd;
                font-size: 12px;
                border-bottom: 1px solid #404040;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            `;
            item.addEventListener('mouseenter', () => {
                item.style.background = '#505050';
            });
            item.addEventListener('mouseleave', () => {
                item.style.background = 'transparent';
            });
            item.addEventListener('click', () => {
                onSelect(lora);
                popup.remove();
            });
            resultsContainer.appendChild(item);
        });

        if (filtered.length > 50) {
            const more = document.createElement('div');
            more.textContent = `... and ${filtered.length - 50} more`;
            more.style.cssText = 'padding: 8px; color: #888; font-style: italic; text-align: center;';
            resultsContainer.appendChild(more);
        }
    }

    // Input event handler
    input.addEventListener('input', () => {
        renderResults(input.value);
    });

    // Handle keyboard navigation
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            popup.remove();
        } else if (e.key === 'Enter') {
            const firstResult = resultsContainer.querySelector('div');
            if (firstResult && firstResult.textContent !== 'No matches found') {
                const filterLower = input.value.toLowerCase();
                const filtered = loraList.filter(l => l.toLowerCase().includes(filterLower));
                if (filtered.length > 0) {
                    onSelect(filtered[0]);
                    popup.remove();
                }
            }
        }
    });

    // Close popup when clicking outside
    const closeHandler = (e) => {
        if (!popup.contains(e.target)) {
            popup.remove();
            document.removeEventListener('mousedown', closeHandler);
        }
    };
    setTimeout(() => {
        document.addEventListener('mousedown', closeHandler);
    }, 100);

    popup.appendChild(input);
    popup.appendChild(resultsContainer);
    document.body.appendChild(popup);

    // Initial render with all items
    renderResults('');

    // Focus the input
    input.focus();
}

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
                this.addLoraButton = this.addWidget("button", "➕ Add LoRa", null, () => {
                    this.addLoraSlot();
                }, { serialize: false });

                // Add initial LoRa slots (start with 1 empty slot)
                this.addLoraSlot();

                // Force node to recalculate size
                this.setSize(this.computeSize());

                return r;
            };

            /**
             * Add a new LoRa slot with a single custom widget
             */
            nodeType.prototype.addLoraSlot = function() {
                const slotIndex = ++this.slotCounter;
                const self = this;

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

                // Create a single custom widget for the entire row
                const loraRowWidget = {
                    type: "lora_row",
                    name: `lora_${slotIndex}`,
                    slotData: slotData,
                    options: {},

                    // Getter for value - returns dict format for Python
                    get value() {
                        return {
                            on: slotData.enabled,
                            lora: slotData.lora || "",
                            strength: slotData.strength,
                            triggers: slotData.triggers || ""
                        };
                    },
                    // Setter for value - handles both string and dict formats
                    set value(v) {
                        if (typeof v === 'object' && v !== null) {
                            slotData.enabled = v.on !== false;
                            slotData.lora = v.lora || "";
                            slotData.strength = v.strength ?? 1.0;
                            slotData.triggers = v.triggers || "";
                        } else if (typeof v === 'string') {
                            slotData.lora = v;
                        }
                    },

                    // Draw the widget
                    draw: function(ctx, node, widgetWidth, y, widgetHeight) {
                        const margin = 10;
                        const toggleSize = 20;
                        const strengthWidth = 70;
                        const padding = 5;

                        // Background
                        ctx.fillStyle = slotData.enabled ? "#353535" : "#252525";
                        ctx.beginPath();
                        ctx.roundRect(margin, y, widgetWidth - margin * 2, widgetHeight, 4);
                        ctx.fill();

                        // Toggle circle
                        const toggleX = margin + padding + toggleSize / 2;
                        const toggleY = y + widgetHeight / 2;
                        ctx.beginPath();
                        ctx.arc(toggleX, toggleY, toggleSize / 2 - 2, 0, Math.PI * 2);
                        ctx.fillStyle = slotData.enabled ? "#6c6" : "#444";
                        ctx.fill();
                        ctx.strokeStyle = "#666";
                        ctx.lineWidth = 1;
                        ctx.stroke();

                        // LoRa name
                        const loraX = margin + padding + toggleSize + padding;
                        const loraWidth = widgetWidth - margin * 2 - toggleSize - strengthWidth - padding * 4;
                        ctx.fillStyle = slotData.enabled ? "#ddd" : "#888";
                        ctx.font = "12px Arial";
                        ctx.textAlign = "left";
                        ctx.textBaseline = "middle";

                        let displayName = slotData.lora || "(select lora)";
                        // Truncate if too long
                        if (displayName.length > 30) {
                            displayName = "..." + displayName.slice(-27);
                        }
                        ctx.fillText(displayName, loraX, y + widgetHeight / 2);

                        // Strength box
                        const strengthX = widgetWidth - margin - strengthWidth - padding;
                        ctx.fillStyle = "#252525";
                        ctx.beginPath();
                        ctx.roundRect(strengthX, y + 3, strengthWidth, widgetHeight - 6, 3);
                        ctx.fill();

                        // Strength value
                        ctx.fillStyle = slotData.enabled ? "#fff" : "#888";
                        ctx.textAlign = "center";
                        ctx.fillText(slotData.strength.toFixed(2), strengthX + strengthWidth / 2, y + widgetHeight / 2);

                        // Strength arrows
                        ctx.fillStyle = "#888";
                        ctx.font = "10px Arial";
                        ctx.fillText("◀", strengthX + 8, y + widgetHeight / 2);
                        ctx.fillText("▶", strengthX + strengthWidth - 8, y + widgetHeight / 2);

                        // Store hit areas for mouse handling
                        this.hitAreas = {
                            toggle: { x: margin, y: y, width: toggleSize + padding * 2, height: widgetHeight },
                            lora: { x: loraX, y: y, width: loraWidth, height: widgetHeight },
                            strengthDec: { x: strengthX, y: y, width: 20, height: widgetHeight },
                            strengthVal: { x: strengthX + 20, y: y, width: strengthWidth - 40, height: widgetHeight },
                            strengthInc: { x: strengthX + strengthWidth - 20, y: y, width: 20, height: widgetHeight }
                        };
                    },

                    // Handle mouse events
                    mouse: function(event, pos, node) {
                        if (event.type !== "pointerdown") return false;

                        const localX = pos[0];
                        const localY = pos[1];

                        if (!this.hitAreas) return false;

                        // Check toggle click
                        const toggle = this.hitAreas.toggle;
                        if (localX >= toggle.x && localX <= toggle.x + toggle.width) {
                            slotData.enabled = !slotData.enabled;
                            node.setDirtyCanvas(true);
                            return true;
                        }

                        // Check lora click - show searchable dropdown
                        const lora = this.hitAreas.lora;
                        if (localX >= lora.x && localX <= lora.x + lora.width) {
                            const loraList = self.loraList || [];
                            if (loraList.length > 0) {
                                showLoraSearchPopup(event, loraList, (selectedLora) => {
                                    slotData.lora = selectedLora;
                                    self.loadTriggersForSlot(slotData);
                                    node.setDirtyCanvas(true);
                                });
                            }
                            return true;
                        }

                        // Check strength decrease
                        const sDec = this.hitAreas.strengthDec;
                        if (localX >= sDec.x && localX <= sDec.x + sDec.width) {
                            slotData.strength = Math.max(-20, slotData.strength - 0.05);
                            node.setDirtyCanvas(true);
                            return true;
                        }

                        // Check strength increase
                        const sInc = this.hitAreas.strengthInc;
                        if (localX >= sInc.x && localX <= sInc.x + sInc.width) {
                            slotData.strength = Math.min(20, slotData.strength + 0.05);
                            node.setDirtyCanvas(true);
                            return true;
                        }

                        // Check strength value click - allow direct input
                        const sVal = this.hitAreas.strengthVal;
                        if (localX >= sVal.x && localX <= sVal.x + sVal.width) {
                            const newValue = prompt("Enter strength value:", slotData.strength.toFixed(2));
                            if (newValue !== null) {
                                const parsed = parseFloat(newValue);
                                if (!isNaN(parsed)) {
                                    slotData.strength = Math.max(-20, Math.min(20, parsed));
                                    node.setDirtyCanvas(true);
                                }
                            }
                            return true;
                        }

                        return false;
                    },

                    // Compute height
                    computeSize: function(width) {
                        return [width, 26];
                    }
                };

                // Add widget to node
                this.widgets.push(loraRowWidget);

                // Move before add button
                if (addButtonIndex !== -1) {
                    this.widgets.splice(this.widgets.indexOf(loraRowWidget), 1);
                    this.widgets.splice(addButtonIndex, 0, loraRowWidget);
                }

                // Store widget reference
                slotData.widget = loraRowWidget;
                slotData.widgets = [loraRowWidget];

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
             * Get context menu options - show submenu for each LoRa slot
             */
            nodeType.prototype.getExtraMenuOptions = function(_, options) {
                const self = this;

                // Add submenu for each LoRa slot
                if (this.loraSlots && this.loraSlots.length > 0) {
                    for (let i = 0; i < this.loraSlots.length; i++) {
                        const slot = this.loraSlots[i];
                        const slotLabel = slot.lora ? slot.lora.split(/[/\\]/).pop() : `LoRa ${slot.index}`;

                        const submenuOptions = [];

                        // Remove option
                        submenuOptions.push({
                            content: "🗑️ Remove",
                            callback: () => {
                                self.removeLoraSlot(slot);
                            }
                        });

                        // Move up (if not first)
                        if (i > 0) {
                            submenuOptions.push({
                                content: "⬆️ Move Up",
                                callback: () => {
                                    self.moveLoraSlot(slot, -1);
                                }
                            });
                        }

                        // Move down (if not last)
                        if (i < this.loraSlots.length - 1) {
                            submenuOptions.push({
                                content: "⬇️ Move Down",
                                callback: () => {
                                    self.moveLoraSlot(slot, 1);
                                }
                            });
                        }

                        options.push({
                            content: `LoRa ${slot.index}: ${slotLabel}`,
                            has_submenu: true,
                            submenu: {
                                options: submenuOptions
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

                // Add new LoRa option
                options.push({
                    content: "➕ Add LoRa Slot",
                    callback: () => {
                        this.addLoraSlot();
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

                // Remove the slot's widget from the node
                if (slotData.widget) {
                    const widgetIndex = this.widgets.indexOf(slotData.widget);
                    if (widgetIndex !== -1) {
                        this.widgets.splice(widgetIndex, 1);
                    }
                }

                // Remove from slots array
                this.loraSlots.splice(slotIndex, 1);

                // Force node to recalculate size
                this.setSize(this.computeSize());
                this.setDirtyCanvas(true, true);

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

                // Move widgets in the widgets array (each slot has 1 widget now)
                const widget1 = this.loraSlots[slotIndex].widget;
                const widget2 = this.loraSlots[newIndex].widget;

                const widget1Index = this.widgets.indexOf(widget1);
                const widget2Index = this.widgets.indexOf(widget2);

                // Swap widgets in place
                this.widgets[widget1Index] = widget2;
                this.widgets[widget2Index] = widget1;

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
                        if (this.loraSlots.length - slotsToRemove.length > 1) {
                            slotsToRemove.push(slot);
                        }
                    }
                }

                // Remove the empty slots
                for (const slot of slotsToRemove) {
                    this.removeLoraSlot(slot);
                }

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

                console.log("onSerialize called, loraSlots:", this.loraSlots);

                // Replace each lora widget's value with a dict for execution
                for (const slot of this.loraSlots || []) {
                    const widgetIndex = this.widgets.indexOf(slot.widget);
                    console.log(`Slot ${slot.index}: widgetIndex=${widgetIndex}, lora=${slot.lora}, triggers='${slot.triggers}'`);
                    if (widgetIndex !== -1) {
                        o.widgets_values[widgetIndex] = {
                            on: slot.enabled,
                            lora: slot.lora || "",
                            strength: slot.strength,
                            triggers: slot.triggers || ""
                        };
                    }
                }
                console.log("onSerialize result widgets_values:", o.widgets_values);
            };

            /**
             * Serialize node state for workflow save
             */
            const originalSerialize = nodeType.prototype.serialize;
            nodeType.prototype.serialize = function() {
                const data = originalSerialize ? originalSerialize.apply(this, arguments) : {};

                // Save slot states (don't save index or counter - they'll be regenerated)
                data.lora_slots = this.loraSlots.map(slot => ({
                    enabled: slot.enabled,
                    lora: slot.lora,
                    strength: slot.strength,
                    triggers: slot.triggers
                }));

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
                if (data.lora_slots && Array.isArray(data.lora_slots) && data.lora_slots.length > 0) {
                    // Clear existing slots and reset counter
                    this.loraSlots = [];
                    this.slotCounter = 0;

                    // Keep reference to the add button (stored during onNodeCreated)
                    const addButtonWidget = this.addLoraButton;

                    // Remove all widgets except the add button
                    this.widgets = addButtonWidget ? [addButtonWidget] : [];

                    // Recreate slots from saved data (indices will be assigned fresh)
                    for (const slotInfo of data.lora_slots) {
                        const slot = this.addLoraSlot();

                        // Restore slot data (widget getter reads from slotData directly)
                        slot.enabled = slotInfo.enabled !== false;  // Default to true
                        slot.lora = slotInfo.lora || "";
                        slot.strength = slotInfo.strength ?? 1.0;
                        slot.triggers = "";  // Will be loaded from database

                        // Load triggers from database if lora is set
                        if (slot.lora) {
                            this.loadTriggersForSlot(slot);
                        }
                    }

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
                this.setDirtyCanvas(true, true);
            };
        }
    }
});
