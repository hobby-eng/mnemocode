"""Checks MnemoCode's start menu and secret input in a pseudo-terminal.

    python3 scripts/verify-terminal-input.py [PROGRAM]

On Linux and macOS it uses a Unix pseudo-terminal; on Windows a
pseudo-console (ConPTY) through the pywinpty package, pinned with its
hashes in scripts/verify-terminal-input-requirements.txt. PROGRAM is
dist/mnemocode.js by default, run with node, or an executable; build it
first (pnpm build). Only the public BIP39 test phrase "abandon ...
about", its word numbers "1 1 ... 4", its fingerprint 73c5da0a, and that
phrase masked with the README's date and its Shamir shares are used.

It checks that
- without arguments the menu appears; Down, Up and Enter or a digit
  choose, Ctrl+Up's 5 chooses nothing, and Escape alone, which every
  keyboard layout has, or q goes back and quits;
- Escape at a typed question of an entry goes back to the menu and
  leaves the screen as it was before the entry was chosen;
- the card questions of Encode in colors: how the cards are saved, a QR
  code on the sheets only, and the person's own details, a wrong one
  asked again and Enter keeping one random, each answer in the command
  that the menu runs and nothing else;
- Decode, with the word numbers typed at its prompt, recovers the test
  phrase on the terminal's alternate screen, the private screen: what is
  typed there is shown, and the screen is left and cleared after Enter;
- Backspace and Ctrl+U edit the answer, and Home, End and Delete edit it
  at the cursor;
- Ctrl+C stops a long date search and leaves the private screen;
- an answer longer than 4095 bytes arrives whole, where a terminal's
  line mode on Linux would cut it;
- a seed phrase pasted one word per line is one answer (Encode with
  dates), and the backup typed again with its date passes the check that
  Encode offers;
- Re-encode makes a backup made before again: typed with its date, its
  phrase is shown and confirmed by the fingerprint of the wallet, and
  only then the new backup is asked; for a backup of the Original
  Seedshift with a valid last word, a wrong date leaves no phrase that
  ends with the last word, and the dates are typed again, keeping the
  codes;
- Decode asks again after an empty answer and after a mistyped date,
  keeping the codes, and finds a date with ? by the fingerprint of the
  test phrase;
- the encoded fingerprint stays on the screen of the dates in Decode,
  recover-date and a restore from shares, with and without colour, also
  from the menu; a question keeps the line that says why it is asked,
  and loses it when the question is left with Escape;
- a result longer than the screen, a share set with its heading, notices
  and fingerprints, is read whole by pages before the question or prompt
  under it, at 80x24 and 32x12;
- recover-word asks what comes next under its result, which stays on
  the screen with every warning it gave, when no candidate matched the
  wallet and when the candidates are too many to show; a short list of
  candidates taller than the screen is read whole by pages;
- an answer under a result that leads to another step starts a screen
  of its own, without the old result: the dates typed again in Decode,
  recover-date and Re-encode, and recover-date's search with another
  wallet, which is asked under the result; the legacy replacements of
  recover-word stand on a screen of their own, without the phrase
  typed;
- Re-encode keeps the heading and the notices of its confirmation on the
  screens of the new backup, the wallet warning once, and a refusal
  above the questions asked again, also after a chosen answer; the
  heading never goes to standard output, and a refused answer warns of
  no cloud folder; a cloud warning given with the options stays with its
  link on every screen;
- Restore from Shamir shares asks again after Ctrl+D on an empty line,
  takes two shares pasted as two lines as one answer, asks again only
  for the share that cannot be read, and finds a date with ? by the
  fingerprint;
- nothing typed or shown in Decode, Encode or Restore that is secret
  reaches the main screen, which stays in the scrollback;
- once a command leaves the private screen, the main screen keeps its
  summary: the record it saved, the cloud warning with its link and the
  warning that a fingerprint is only a filter, then that the result was
  cleared, or "Cancelled." once after the warnings of a cancelled one,
  and none of the phrase, codes, dates or fingerprint;
- Escape or Ctrl+C at a prompt for a secret leaves the private screen;
  in the menu it cancels that command and the menu comes back; a typed
  command ends
  with exit code 130; Ctrl+C while card images are drawn ends the
  command as cancelled, leaving no temporary folder of the export;
- Escape or q in the menu ends it with exit code 0, and Ctrl+C there
  with 130.
"""

import sys

from terminal_context_checks import (
    check_cloud_link_kept,
    check_context_ends_at_escape,
    check_fingerprint_before_dates,
    check_fingerprint_before_dates_in_menu,
    check_new_backup_heading_on_screen,
    check_question_reason_kept,
)
from terminal_export_checks import (
    check_ctrl_c_during_image_export,
    check_interrupt_at_clear_prompt,
    check_interrupt_without_terminal,
)
from terminal_result_checks import (
    check_private_result_pages,
    check_share_pages,
    check_word_candidate_pages,
    check_word_result_under_question,
)
from terminal_menu_checks import (
    check_back_from_entry,
    check_card_questions,
    check_cancel_at_prompt,
    check_cursor_editing,
    check_date_search_ctrl_c,
    check_decode_menu,
    check_lines_pasted_as_one_answer,
    check_long_line,
    check_lookup_repeat,
    check_table_exports,
    check_marked_codes_entry,
    check_menu_ctrl_c,
    check_share_word_hints,
    check_word_hints,
)
from terminal_step_checks import check_steps_after_result
from terminal_summary_checks import (
    check_summary_after_cancel,
    check_summary_after_save,
    check_summary_of_date_search,
)
from terminal_secret_checks import (
    check_candidate_passphrase_roles,
    check_marked_codes_result,
    check_file_or_text_input,
    check_decode_dates_asked_again,
    check_decode_share_lines,
    check_encode_result_visible,
    check_phrase_display_choices,
    check_re_encode_answer_refused,
    check_re_encode_last_word_after_wrong_date,
    check_re_encode_menu,
    check_re_encode_marked_shares,
    check_re_encode_recognised,
    check_restore_share_asked_again,
)


def main():
    """Runs every check in turn; a failed one raises AssertionError."""
    # Each result is written at once, so that a CI log shows how far the
    # checks came.
    sys.stdout.reconfigure(line_buffering=True)
    check_decode_menu()
    check_back_from_entry()
    check_card_questions()
    check_menu_ctrl_c()
    check_long_line()
    check_cursor_editing()
    check_word_hints()
    check_lookup_repeat()
    check_table_exports()
    check_share_word_hints()
    check_marked_codes_entry()
    check_marked_codes_result()
    check_lines_pasted_as_one_answer()
    check_encode_result_visible()
    check_phrase_display_choices()
    check_re_encode_menu()
    check_re_encode_answer_refused()
    check_re_encode_recognised()
    check_re_encode_marked_shares()
    check_re_encode_last_word_after_wrong_date()
    check_decode_dates_asked_again()
    check_fingerprint_before_dates()
    check_fingerprint_before_dates_in_menu()
    check_question_reason_kept()
    check_context_ends_at_escape()
    check_cloud_link_kept()
    check_new_backup_heading_on_screen()
    check_decode_share_lines()
    check_file_or_text_input()
    check_restore_share_asked_again()
    check_private_result_pages()
    check_share_pages()
    check_word_result_under_question()
    check_word_candidate_pages()
    check_steps_after_result()
    check_candidate_passphrase_roles()
    check_cancel_at_prompt()
    check_ctrl_c_during_image_export()
    check_interrupt_without_terminal()
    check_interrupt_at_clear_prompt()
    check_summary_after_save()
    check_summary_after_cancel()
    check_summary_of_date_search()
    check_date_search_ctrl_c()
    print("terminal input checks passed")


if __name__ == "__main__":
    main()
