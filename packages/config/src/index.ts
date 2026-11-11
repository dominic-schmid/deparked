export { fillDomain, type SentencePart, sentenceParts } from "./copy";
export { defaultConfig } from "./defaults";
export { migrateConfig } from "./migrate";
export { type ConfigErrors, type ConfigResult, parseConfig } from "./parse";
export {
  CONFIG_VERSION,
  type Config,
  CURRENCIES,
  type Currency,
  configSchema,
  LIMITS,
  MINOR_UNITS_PER_MAJOR,
  SENTENCE_SLOTS,
  type SentenceSlot,
  VARIANTS,
  type Variant,
} from "./schema";
