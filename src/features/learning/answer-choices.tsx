'use client';

import { RichText } from './content-blocks';

/**
 * The options of a question a learner picks from, drawn the same way wherever the question is put.
 *
 * A lesson, a set and a placement all ask the same kinds of question, and until now only the first
 * two could draw this one — the placement had a box for writing in and nothing else, so the
 * sixty-five questions of the bank that are answered by picking arrived with their options missing
 * and no way to answer them at all. The drawing lives here so that a third place to ask cannot
 * lose them again.
 *
 * The option's id is the answer; its text is only what the learner reads. Two options may read
 * alike and still be different answers, so nothing here is compared by what it says.
 */
export function AnswerChoices({ name, options, value, disabled, onPick }: {
  name: string;
  options: { id: string; text: string }[];
  /** The id of the picked option, or an empty string while nothing is picked. */
  value: string;
  disabled?: boolean;
  onPick: (id: string) => void;
}) {
  return <fieldset className="answer-choices" disabled={disabled}>
    <legend>답 고르기</legend>
    {options.map((option) => <label key={option.id} className={value === option.id ? 'answer-choice is-picked' : 'answer-choice'}>
      <input type="radio" name={name} value={option.id} checked={value === option.id} onChange={() => onPick(option.id)} />
      <span><RichText text={option.text} /></span>
    </label>)}
  </fieldset>;
}
