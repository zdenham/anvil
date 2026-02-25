declare const __MORT_APP_SUFFIX__: string;
export const APP_SUFFIX = __MORT_APP_SUFFIX__;
export const IS_ALTERNATE_BUILD = APP_SUFFIX !== '';

/** Gateway server base URL (hosts /gateway/, /logs, /identity endpoints) */
export const GATEWAY_BASE_URL = "https://mort-server.fly.dev";
