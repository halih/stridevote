"use client";

import { useRouter } from "next/navigation";

/** Clears the voter filter form fields and returns to the unfiltered directory. */
export function ClearVoterFiltersButton({ slug }: { slug: string }) {
  const router = useRouter();

  function clear() {
    const form = document.querySelector<HTMLFormElement>("form.voter-filters");
    if (form) {
      for (const element of Array.from(form.elements)) {
        if (element instanceof HTMLInputElement) {
          if (element.type === "checkbox" || element.type === "radio") {
            element.checked = false;
          } else if (element.type !== "submit" && element.type !== "button") {
            element.value = "";
          }
        } else if (element instanceof HTMLSelectElement) {
          element.selectedIndex = 0;
        }
      }
    }
    router.push(`/admin/${slug}/voters`);
    router.refresh();
  }

  return (
    <button type="button" className="btn btn-outline btn-sm" onClick={clear}>
      Clear
    </button>
  );
}
