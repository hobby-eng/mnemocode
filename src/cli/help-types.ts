// The shapes of the help pages: a command's page, a topic's, and their options and rows.

export interface HelpOption {
  /** The option as typed, such as "--mode". */
  flag: string;
  /** Its value, such as "MODE"; none for an on-or-off option. */
  value?: string;
  /** One line for `-h`; also the first paragraph of `--help`. */
  summary: string;
  /** Further paragraphs for `--help`. */
  details?: readonly string[];
}

export interface HelpGroup {
  heading: string;
  options: readonly HelpOption[];
}

export type HelpRow = readonly [string, string];

export interface CommandHelp {
  summary: string;
  /** Paragraphs under the summary in `--help`. */
  about: readonly string[];
  /** What follows "mnemocode <command> " in the usage line. */
  usage: string;
  groups: readonly HelpGroup[];
  /** What the prompts of --ask-secrets ask for, in `--help`. */
  asks?: readonly HelpRow[];
  examples: readonly HelpRow[];
  /** Closing paragraphs of `--help`. */
  notes?: readonly string[];
}

export interface TopicSection {
  heading: string;
  paragraphs?: readonly string[];
  rows?: readonly HelpRow[];
}

export interface TopicHelp {
  summary: string;
  sections: readonly TopicSection[];
  examples?: readonly HelpRow[];
}
