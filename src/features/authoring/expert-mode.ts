'use client';

import { createContext, useContext } from 'react';

/**
 * Whether this screen is being read by someone who also operates the service. With it on the editor
 * shows the names the records use — block and version identifiers, the switches that keep an older
 * app able to open a lesson — and with it off a lesson is all that is left. It is a setting on the
 * account, so it follows a person between browsers, and it changes only what is shown: every rule
 * about what may be written or published is the server's and is the same either way.
 */
export const ExpertMode = createContext(false);
export const useExpertMode = () => useContext(ExpertMode);
