// System tray icon and the menu shared with the pet's right-click.
import { Menu, nativeImage, Tray, type BrowserWindow, type NativeImage } from "electron";
import type { SpeciesId } from "../shared/species";
import { iconPixels, paletteFor } from "../shared/sprite";
import { encodePng, indexedToRgba } from "./png";

export interface TrayState {
  name: string;
  species: SpeciesId;
  theme: string;
  visible: boolean;
  doNotDisturb: boolean;
  vision: boolean;
  online: boolean;
  spentToday: number;
  budget: number;
  hotkey: string;
}

export interface TrayActions {
  talk(): void;
  toggleVisible(): void;
  toggleDoNotDisturb(): void;
  toggleVision(): void;
  sendToOtherScreen(): void;
  openSettings(): void;
  openDataFolder(): void;
  quit(): void;
}

export function petIcon(species: SpeciesId, theme: string): NativeImage {
  const palette = paletteFor(species, theme);
  const pixels = iconPixels(species);
  const image = nativeImage.createFromBuffer(encodePng(16, 16, indexedToRgba(pixels, 16, palette, 1)), { scaleFactor: 1 });
  image.addRepresentation({ scaleFactor: 2, buffer: encodePng(32, 32, indexedToRgba(pixels, 16, palette, 2)) });
  return image;
}

export class PetTray {
  private readonly tray: Tray;
  private look: string;

  constructor(
    private readonly actions: TrayActions,
    private readonly state: () => TrayState,
  ) {
    const initial = state();
    this.look = `${initial.species}/${initial.theme}`;
    this.tray = new Tray(petIcon(initial.species, initial.theme));
    this.tray.on("click", () => actions.talk());
    this.refresh();
  }

  refresh(): void {
    const s = this.state();
    if (`${s.species}/${s.theme}` !== this.look) {
      this.look = `${s.species}/${s.theme}`;
      this.tray.setImage(petIcon(s.species, s.theme));
    }
    this.tray.setToolTip(s.online ? `${s.name} - clic per parlare` : `${s.name} - modalità offline (nessun servizio di IA configurato)`);
    this.tray.setContextMenu(this.menu());
  }

  popup(window: BrowserWindow): void {
    this.menu().popup({ window });
  }

  dispose(): void {
    this.tray.destroy();
  }

  private menu(): Menu {
    const s = this.state();
    const a = this.actions;
    return Menu.buildFromTemplate([
      { label: `Parla con ${s.name}…`, accelerator: s.hotkey || undefined, registerAccelerator: false, click: () => a.talk() },
      { type: "separator" },
      { label: `Mostra ${s.name}`, type: "checkbox", checked: s.visible, click: () => a.toggleVisible() },
      { label: "Non disturbare", type: "checkbox", checked: s.doNotDisturb, click: () => a.toggleDoNotDisturb() },
      { label: "Può guardare lo schermo", type: "checkbox", checked: s.vision, click: () => a.toggleVision() },
      { label: "Vai sull'altro schermo", click: () => a.sendToOtherScreen() },
      { type: "separator" },
      {
        label: s.online
          ? `Spesa di oggi: $${s.spentToday.toFixed(2)}${s.budget > 0 ? ` su $${s.budget.toFixed(2)}` : ""}`
          : "Offline: configura un servizio di IA",
        enabled: false,
      },
      { label: "Impostazioni…", click: () => a.openSettings() },
      { label: "Apri la cartella dei dati", click: () => a.openDataFolder() },
      { type: "separator" },
      { label: "Esci", click: () => a.quit() },
    ]);
  }
}
