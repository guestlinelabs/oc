// Vendored from oc-client-browser@2.1.13 (MIT License, (c) OpenComponents
// community). See LICENSE.md in this directory. Entry point bundled at
// registry startup by src/registry/domain/compile-client.ts via Bun.build.
// @ts-nocheck
import { LJS } from './loader';
import { createOc } from './oc-client';

window.ljs = new LJS();
window.oc = createOc(window.oc || {});
