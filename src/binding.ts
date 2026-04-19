// see: https://michaelmovsesov.com/articles/angular-like-two-way-data-binding-vanilla-js

'use strict'

// Cache DOM elements
const inputElements = document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-model]');
const boundElements = document.querySelectorAll<HTMLElement>('[data-bind]');

// Shared scope object – exported so app.ts can read/write bound values.
export const scope: Record<string, unknown> = {};


function init() {
    // Loop through input elements
    for (const el of inputElements) {
        // Get property name from each input with an attribute of 'data-model'
        const propName = el.getAttribute('data-model');
        if (!propName) {
            continue;
        }

        // Update bound scope property on input change
        el.addEventListener('keyup', () => { scope[propName] = el.value; });
        el.addEventListener('mouseup', () => { scope[propName] = el.value; });

        // Set property update logic
        setPropUpdateLogic(propName);
    }
}

function setPropUpdateLogic(prop: string) {
    if (!Object.prototype.hasOwnProperty.call(scope, prop)) {
        let value: unknown;
        Object.defineProperty(scope, prop, {
            // Automatically update bound dom elements when a scope property is set to a new value
            set: (newValue: unknown) => {
                value = newValue;

                // Set input elements to new value
                for (const el of inputElements) {
                    if (el.getAttribute('data-model') === prop) {
                        if (el.type) {
                            el.value = String(newValue);
                        }
                    }
                }
                // Set all other bound dom elements to new value
                for (const el of boundElements) {
                    if (el.getAttribute('data-bind') === prop) {
                        if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLSelectElement)) {
                            el.innerHTML = String(newValue);
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

function docReady(fn: () => void) {
    // see if DOM is already available
    if (document.readyState === "complete" || document.readyState === "interactive") {
        // call on next available tick
        setTimeout(fn, 1);
    } else {
        document.addEventListener("DOMContentLoaded", fn);
    }
}

docReady(function () {
    init();
});
