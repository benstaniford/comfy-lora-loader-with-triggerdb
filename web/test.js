console.log("=== LoRa Loader JavaScript STARTING ===");

import { app } from "../../scripts/app.js";

console.log("=== LoRa Loader JavaScript IMPORTS DONE ===");

// Test extension
app.registerExtension({
    name: "LoRaLoaderWithTriggerDB.Test",
    
    async setup() {
        console.log("=== LoRa Loader JavaScript SETUP CALLED ===");
    },
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        console.log("=== beforeRegisterNodeDef called for:", nodeData.name, "===");
        
        if (nodeData.name === "LoRaLoaderWithTriggerDB") {
            console.log("=== FOUND OUR NODE! ===");
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function() {
                console.log("=== NODE CREATED! ===");
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                // Add a simple test button
                console.log("=== ADDING BUTTON ===");
                this.addWidget("button", "TEST", "", () => {
                    alert("Button works!");
                });
                
                console.log("=== BUTTON ADDED ===");
                return r;
            };
        }
    }
});

console.log("=== LoRa Loader JavaScript LOADED ===");
