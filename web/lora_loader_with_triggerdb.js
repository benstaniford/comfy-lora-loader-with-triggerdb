import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

console.log("LoRa Loader JavaScript file loaded!");

// Extension for LoRa Loader with Trigger DB
app.registerExtension({
    name: "LoRaLoaderWithTriggerDB",
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        console.log("beforeRegisterNodeDef called for:", nodeData.name);
        
        if (nodeData.name === "LoRaLoaderWithTriggerDB") {
            console.log("Registering LoRa Loader with Trigger DB");
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function() {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                console.log("LoRa Loader Node Created - widgets:", this.widgets.map(w => w.name));
                
                // Find the widgets
                const loraWidget = this.widgets.find(w => w.name === "lora_name");
                const triggerWidget = this.widgets.find(w => w.name === "trigger_words");
                
                console.log("Found widgets:", { lora: !!loraWidget, trigger: !!triggerWidget });
                
                if (loraWidget && triggerWidget) {
                    console.log("Adding buttons to LoRa Loader node");
                    
                    // Store original callback
                    const originalLoraCallback = loraWidget.callback;
                    
                    // Override the LoRa callback to auto-load triggers when LoRa changes
                    loraWidget.callback = async function(value) {
                        if (originalLoraCallback) {
                            originalLoraCallback.call(this, value);
                        }
                        
                        // Auto-load triggers for the selected LoRa if trigger field is empty
                        if (!triggerWidget.value || triggerWidget.value.trim() === "") {
                            try {
                                const response = await api.fetchApi("/lora_triggers", {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({
                                        lora_name: value
                                    })
                                });
                                
                                if (response.ok) {
                                    const data = await response.json();
                                    if (data.trigger_words) {
                                        triggerWidget.value = data.trigger_words;
                                        triggerWidget.callback && triggerWidget.callback(data.trigger_words);
                                    }
                                }
                            } catch (error) {
                                console.log("Could not auto-load triggers:", error);
                            }
                        }
                    };
                    
                    // Add a simple test button first
                    console.log("Adding test button");
                    this.addWidget("button", "🔥 Test Button", "", () => {
                        console.log("Test button clicked!");
                        alert("Test button works!");
                    }, { serialize: false });
                    
                    // Add load triggers button
                    console.log("Adding load triggers button");
                    this.addWidget("button", "📥 Load Triggers", "", async () => {
                        const loraName = loraWidget.value;
                        if (!loraName) {
                            console.log("No LoRa selected");
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
                                if (data.trigger_words) {
                                    triggerWidget.value = data.trigger_words;
                                    triggerWidget.callback && triggerWidget.callback(data.trigger_words);
                                    console.log(`Loaded triggers for ${loraName}: ${data.trigger_words}`);
                                } else {
                                    console.log(`No saved triggers found for ${loraName}`);
                                }
                            }
                        } catch (error) {
                            console.error("Error loading triggers:", error);
                        }
                    }, { serialize: false });
                    
                    // Add save triggers button
                    this.addWidget("button", "💾 Save Triggers", "", async () => {
                        const loraName = loraWidget.value;
                        const triggers = triggerWidget.value;
                        
                        if (!loraName) {
                            console.log("No LoRa selected");
                            return;
                        }
                        
                        if (!triggers || triggers.trim() === "") {
                            console.log("No trigger words to save");
                            return;
                        }
                        
                        try {
                            const response = await api.fetchApi("/lora_triggers_save", {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                    lora_name: loraName,
                                    trigger_words: triggers
                                })
                            });
                            
                            if (response.ok) {
                                const data = await response.json();
                                if (data.success) {
                                    console.log(data.message);
                                } else {
                                    console.error("Save failed:", data.message);
                                }
                            }
                        } catch (error) {
                            console.error("Error saving triggers:", error);
                        }
                    }, { serialize: false });
                    
                    console.log("Finished adding buttons. Total widgets:", this.widgets.length);
                    this.widgets.forEach((w, i) => console.log(`Widget ${i}: ${w.name} (${w.type})`));
                    
                    // Force the node to resize to show the new buttons
                    this.computeSize();
                    this.setDirtyCanvas(true, true);
                } else {
                    console.log("Could not find required widgets");
                }
                
                return r;
            };
        }
    }
});
