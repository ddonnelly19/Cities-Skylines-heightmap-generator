// @ts-nocheck
// see: https://michaelmovsesov.com/articles/angular-like-two-way-data-binding-vanilla-js
'use strict';
// Cache DOM elements
const inputElements = document.querySelectorAll('[data-model]');
const boundElements = document.querySelectorAll('[data-bind]');
// Initialize scope variable to hold the state of the model.
var scope = {};
function init() {
    // Loop through input elements
    for (let el of inputElements) {
        if (el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'select') {
            // Get property name from each input with an attribute of 'data-model'
            let propName = el.getAttribute('data-model');
            // Update bound scope property on input change
            el.addEventListener('keyup', e => { scope[propName] = el.value; });
            el.addEventListener('mouseup', e => { scope[propName] = el.value; });
            // Set property update logic
            setPropUpdateLogic(propName);
        }
    }
}
;
function setPropUpdateLogic(prop) {
    if (!scope.hasOwnProperty(prop)) {
        let value;
        Object.defineProperty(scope, prop, {
            // Automatically update bound dom elements when a scope property is set to a new value
            set: (newValue) => {
                value = newValue;
                // Set input elements to new value
                for (let el of inputElements) {
                    if (el.getAttribute('data-model') === prop) {
                        if (el.type) {
                            el.value = newValue;
                        }
                    }
                }
                // Set all other bound dom elements to new value
                for (let el of boundElements) {
                    if (el.getAttribute('data-bind') === prop) {
                        if (!el.type) {
                            el.innerHTML = newValue;
                        }
                    }
                }
            },
            get: () => {
                return value;
            },
            enumerable: true
        });
    }
}
function docReady(fn) {
    // see if DOM is already available
    if (document.readyState === "complete" || document.readyState === "interactive") {
        // call on next available tick
        setTimeout(fn, 1);
    }
    else {
        document.addEventListener("DOMContentLoaded", fn);
    }
}
docReady(function () {
    init();
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmluZGluZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9iaW5kaW5nLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLGNBQWM7QUFFZCx5RkFBeUY7QUFFekYsWUFBWSxDQUFBO0FBRVoscUJBQXFCO0FBQ3JCLE1BQU0sYUFBYSxHQUFHLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxjQUFjLENBQUMsQ0FBQztBQUNoRSxNQUFNLGFBQWEsR0FBRyxRQUFRLENBQUMsZ0JBQWdCLENBQUMsYUFBYSxDQUFDLENBQUM7QUFFL0QsNERBQTREO0FBQzVELElBQUksS0FBSyxHQUFRLEVBQUUsQ0FBQztBQUdwQixTQUFTLElBQUk7SUFDVCw4QkFBOEI7SUFDOUIsS0FBSyxJQUFJLEVBQUUsSUFBSSxhQUFhLEVBQUUsQ0FBQztRQUMzQixJQUFJLEVBQUUsQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLEtBQUssT0FBTyxJQUFJLEVBQUUsQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDaEYsc0VBQXNFO1lBQ3RFLElBQUksUUFBUSxHQUFHLEVBQUUsQ0FBQyxZQUFZLENBQUMsWUFBWSxDQUFDLENBQUM7WUFFN0MsOENBQThDO1lBQzlDLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLEVBQUUsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDLEdBQUcsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ25FLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDLEVBQUUsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDLEdBQUcsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBRXJFLDRCQUE0QjtZQUM1QixrQkFBa0IsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNqQyxDQUFDO0lBQ0wsQ0FBQztBQUNMLENBQUM7QUFBQSxDQUFDO0FBRUYsU0FBUyxrQkFBa0IsQ0FBQyxJQUFJO0lBQzVCLElBQUksQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDOUIsSUFBSSxLQUFLLENBQUM7UUFDVixNQUFNLENBQUMsY0FBYyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUU7WUFDL0Isc0ZBQXNGO1lBQ3RGLEdBQUcsRUFBRSxDQUFDLFFBQVEsRUFBRSxFQUFFO2dCQUNkLEtBQUssR0FBRyxRQUFRLENBQUM7Z0JBRWpCLGtDQUFrQztnQkFDbEMsS0FBSyxJQUFJLEVBQUUsSUFBSSxhQUFhLEVBQUUsQ0FBQztvQkFDM0IsSUFBSSxFQUFFLENBQUMsWUFBWSxDQUFDLFlBQVksQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDO3dCQUN6QyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQzs0QkFDVixFQUFFLENBQUMsS0FBSyxHQUFHLFFBQVEsQ0FBQzt3QkFDeEIsQ0FBQztvQkFDTCxDQUFDO2dCQUNMLENBQUM7Z0JBQ0QsZ0RBQWdEO2dCQUNoRCxLQUFLLElBQUksRUFBRSxJQUFJLGFBQWEsRUFBRSxDQUFDO29CQUMzQixJQUFJLEVBQUUsQ0FBQyxZQUFZLENBQUMsV0FBVyxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUM7d0JBQ3hDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUM7NEJBQ1gsRUFBRSxDQUFDLFNBQVMsR0FBRyxRQUFRLENBQUM7d0JBQzVCLENBQUM7b0JBQ0wsQ0FBQztnQkFDTCxDQUFDO1lBQ0wsQ0FBQztZQUNELEdBQUcsRUFBRSxHQUFHLEVBQUU7Z0JBQ04sT0FBTyxLQUFLLENBQUM7WUFDakIsQ0FBQztZQUNELFVBQVUsRUFBRSxJQUFJO1NBQ25CLENBQUMsQ0FBQTtJQUNOLENBQUM7QUFDTCxDQUFDO0FBRUQsU0FBUyxRQUFRLENBQUMsRUFBRTtJQUNoQixrQ0FBa0M7SUFDbEMsSUFBSSxRQUFRLENBQUMsVUFBVSxLQUFLLFVBQVUsSUFBSSxRQUFRLENBQUMsVUFBVSxLQUFLLGFBQWEsRUFBRSxDQUFDO1FBQzlFLDhCQUE4QjtRQUM5QixVQUFVLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO0lBQ3RCLENBQUM7U0FBTSxDQUFDO1FBQ0osUUFBUSxDQUFDLGdCQUFnQixDQUFDLGtCQUFrQixFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBQ3RELENBQUM7QUFDTCxDQUFDO0FBRUQsUUFBUSxDQUFDO0lBQ0wsSUFBSSxFQUFFLENBQUM7QUFDWCxDQUFDLENBQUMsQ0FBQyJ9