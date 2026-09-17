import React, { useEffect, useId, useRef, useState } from "react";
import { IonIcon } from "@ionic/react";
import { ellipsisHorizontalOutline } from "ionicons/icons/index.js";
import "./SessionMenu.scss";

export default function SessionMenu({ onAdvancedConfiguration }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const itemRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    itemRef.current?.focus();
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <div
      className="session-menu"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          buttonRef.current?.focus();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
          itemRef.current?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={buttonRef}
        aria-label="More session options"
        title="More session options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <IonIcon icon={ellipsisHorizontalOutline} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="session-menu-dropdown"
          id={menuId}
          role="menu"
          aria-label="More session options"
        >
          <button
            ref={itemRef}
            type="button"
            role="menuitem"
            onClick={() => {
              buttonRef.current?.focus();
              setOpen(false);
              onAdvancedConfiguration();
            }}
          >
            Advanced configuration
          </button>
        </div>
      )}
    </div>
  );
}
