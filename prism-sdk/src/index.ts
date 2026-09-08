export { Prism } from "./core";
export type {
  PrismConfig,
  Match,
  ProtectResult,
  SendResult,
  SendOptions,
  Transport,
} from "./core";
export { defaultPolicies, maskGeneric } from "./policies";
export type { Policy } from "./policies";
export { MemoryVault, TOKEN_PATTERN } from "./vault";
export type { Vault } from "./vault";