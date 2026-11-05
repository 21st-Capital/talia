/**
 * Two keys of a 2-of-3 testnet vault registered on a Nano X on video
 * (2026-10-04), and every line the Nano X drew them over (hi-nanoX frames
 * f14 to f32): what the device's paging is checked against.
 */
export const NANO_X_KEYS = [
  "[4a290600/48'/1'/0'/2']tpubDErJdogEeCPaWqdEz5R6mxYew51AoQFaigWJgqdztLEZ3rjhJ3t7sL7j7kvGJY3jgmmjMJFSmWDSrur8fEnQLCqH4ZtoN5ELcMGBP5ApFqw",
  "[abf931aa/48'/1'/0'/2']tpubDFA5xftNMV8GN6gvF65DcLG79nZshmxq74Mvi8sbHtdgK9DxEAJpQDvLYXkW1x7dZYgef5VduHCqoWKAxyjmGgLJp4JLMeuc9CWpd2AgU84",
] as const;

export const NANO_X_LINES = [
  ["[4a290600/48'/1'/0'/2']", 'tpubDErJdogEeCPaW', 'qdEz5R6mxYew51Ao', 'QFaigWJgqdztLEZ3rjhJ', '3t7sL7j7kvGJY3jgmmj', 'MJFSmWDSrur8fEnQL', 'CqH4ZtoN5ELcMGBP', '5ApFqw'],
  ["[abf931aa/48'/1'/0'/2']", 'tpubDFA5xftNMV8GN', '6gvF65DcLG79nZshm', 'xq74Mvi8sbHtdgK9D', 'xEAJpQDvLYXkW1x7d', 'ZYgef5VduHCqoWKA', 'xyjmGgLJp4JLMeuc9C', 'Wpd2AgU84'],
] as const;
