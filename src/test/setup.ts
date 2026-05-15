import * as Vitest from "@effect/vitest";
import { cleanup } from "@testing-library/react";

Vitest.addEqualityTesters();

if ("window" in globalThis) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: window.localStorage,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: window.sessionStorage,
  });
}

Vitest.afterEach(() => {
  cleanup();
});
