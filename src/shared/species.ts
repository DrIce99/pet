// Pets the user can choose and their color themes.

export interface SpeciesTheme {
  label: string;
  outline: string;
  body: string;
  shade: string;
  light: string;
  /** Belly (cat) or mane and tail tip (Eevee). */
  belly: string;
  belly2: string;
  /** Inner ear. */
  ear: string;
  eye: string;
  iris: string;
  blush: string;
}

export interface SpeciesInfo {
  label: string;
  /** How the creature is described to the model. */
  description: string;
  defaultName: string;
  themes: Record<string, SpeciesTheme>;
}

const CAT_FIXED = { outline: "#2b2738", eye: "#1d1a29", iris: "#1d1a29", blush: "#ff8ea2" };

export const SPECIES = {
  cat: {
    label: "Gattino",
    description: "a small round cat-like creature with pointy ears and a curly tail",
    defaultName: "Mochi",
    themes: {
      arancio: { ...CAT_FIXED, label: "Arancio", body: "#ffb466", shade: "#e88f45", light: "#ffd6a6", belly: "#ffe6c7", belly2: "#f5cfa4", ear: "#ff9aae" },
      panna: { ...CAT_FIXED, label: "Panna", body: "#f8e4c8", shade: "#e2c29c", light: "#fff4e4", belly: "#fffaf2", belly2: "#f1e3cf", ear: "#ffa8b8" },
      grigio: { ...CAT_FIXED, label: "Grigio", body: "#b9bdcc", shade: "#9196a9", light: "#d9dce6", belly: "#e8eaf0", belly2: "#cfd2dc", ear: "#ffa8b8" },
      menta: { ...CAT_FIXED, label: "Menta", body: "#a6e5c6", shade: "#78c6a2", light: "#cdf4e0", belly: "#e4fbef", belly2: "#c4ecd8", ear: "#ffa8b8" },
      lavanda: { ...CAT_FIXED, label: "Lavanda", body: "#cbbaff", shade: "#a690ee", light: "#e2d8ff", belly: "#f1ecff", belly2: "#dcd2fa", ear: "#ffa8b8" },
      cielo: { ...CAT_FIXED, label: "Cielo", body: "#a8d5ff", shade: "#7cb3e8", light: "#cfe7ff", belly: "#eaf4ff", belly2: "#cde2f6", ear: "#ffa8b8" },
    },
  },
  eevee: {
    label: "Eevee",
    description:
      "Eevee, the Pokémon: a small fox-like creature with soft brown fur, very long ears, a fluffy cream mane around the neck and a big bushy tail with a cream tip",
    defaultName: "Eevee",
    themes: {
      classico: {
        label: "Classico",
        outline: "#3a2312",
        body: "#cf8e4f",
        shade: "#a8692f",
        light: "#e6ad70",
        belly: "#f3e3c1",
        belly2: "#d8c196",
        ear: "#6e3f17",
        eye: "#24130a",
        iris: "#7a4a22",
        blush: "#ec9c7c",
      },
      cromatico: {
        label: "Cromatico (shiny)",
        outline: "#43414d",
        body: "#d4d5db",
        shade: "#a9abb6",
        light: "#eeeff3",
        belly: "#ffffff",
        belly2: "#d6dbe7",
        ear: "#8b8e9c",
        eye: "#1d1a29",
        iris: "#4c74a6",
        blush: "#f2a8b6",
      },
    },
  },
} satisfies Record<string, SpeciesInfo>;

export type SpeciesId = keyof typeof SPECIES;

export function isSpecies(value: unknown): value is SpeciesId {
  return typeof value === "string" && Object.hasOwn(SPECIES, value);
}

/** The theme if it belongs to the species, otherwise the species' first theme. */
export function themeFor(species: SpeciesId, theme: string): { id: string; colors: SpeciesTheme } {
  const themes: Record<string, SpeciesTheme> = SPECIES[species].themes;
  const id = Object.hasOwn(themes, theme) ? theme : Object.keys(themes)[0];
  return { id, colors: themes[id] };
}
