import { createContext, useContext } from "react";

/**
 * Whether this instance stores and serves media (`ALLOW_MEDIA`). The default
 * is false, and so is every state before or instead of an answer: a viewer
 * outside the provider, still waiting, or whose fetch failed treats media as
 * off. A missing answer must never switch image rendering on.
 */
export const MediaConfigContext = createContext(false);

export const useAllowMedia = () => useContext(MediaConfigContext);
