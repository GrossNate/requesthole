import { createContext, useContext } from "react";

/**
 * Whether this instance stores and serves media (`ALLOW_MEDIA`). Undefined
 * while the provider is still asking, so a viewer can wait rather than render
 * one way and then the other. Every other state short of a clear yes is
 * false: a viewer outside the provider, or whose fetch failed, treats media
 * as off. A missing answer must never switch image rendering on.
 */
export const MediaConfigContext = createContext<boolean | undefined>(false);

export const useAllowMedia = () => useContext(MediaConfigContext);
