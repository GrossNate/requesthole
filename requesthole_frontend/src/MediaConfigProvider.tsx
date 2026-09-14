import { useEffect, useState } from "react";
import holeService from "./services";
import { MediaConfigContext } from "./mediaConfigContext";

/** Fetches `/api/config` once for everything beneath it; see the context. */
export default function MediaConfigProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [allowMedia, setAllowMedia] = useState(false);

  useEffect(() => {
    let current = true;
    void holeService.getConfig().then((config) => {
      if (current) setAllowMedia(config.allowMedia);
    });
    return () => {
      current = false;
    };
  }, []);

  return (
    <MediaConfigContext.Provider value={allowMedia}>
      {children}
    </MediaConfigContext.Provider>
  );
}
