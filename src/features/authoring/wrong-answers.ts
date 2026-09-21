'use client';

import { createContext, useContext } from 'react';
import type { WrongAnswer } from '@/shared/authoring';

/**
 * How the editor asks what learners have actually written for one question.
 *
 * It is a context rather than a prop because a question is opened from three screens — a lesson's
 * activity, its review pool, and the placement bank — and all three want the same thing from the
 * same place. A screen that cannot ask leaves it undefined, and the panel simply does not offer it.
 */
export const WrongAnswers = createContext<((problemVersionId: string) => Promise<WrongAnswer[]>) | null>(null);
export const useWrongAnswers = () => useContext(WrongAnswers);
