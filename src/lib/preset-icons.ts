import { AudioLines, Car, Coffee, Crown, Drum, Dumbbell, Ear, Equal, Film, Flame, Gamepad2, Guitar, Headphones, Heart, Mic, Moon, Music, Music2, PartyPopper, Piano, Podcast, Radio, SlidersVertical, Sparkles, Star, Sun, Volume2, Waves, Zap, type LucideIcon } from "lucide-react";

/**
 * Icônes proposées pour les préréglages. On stocke la CLÉ (chaîne) et non le composant : le localStorage ne sait garder que du JSON,
 * et une clé inconnue (liste modifiée plus tard) retombe sur l'icône par défaut au lieu de casser l'affichage.
 */
export const PRESET_ICONS: Record<string, LucideIcon> = {
  sliders: SlidersVertical, music: Music, music2: Music2, headphones: Headphones, mic: Mic, guitar: Guitar, drum: Drum, piano: Piano,
  speaker: Volume2, waves: Waves, audio: AudioLines, radio: Radio, podcast: Podcast, film: Film, game: Gamepad2, car: Car,
  party: PartyPopper, flame: Flame, zap: Zap, star: Star, heart: Heart, crown: Crown, moon: Moon, sun: Sun,
  sparkles: Sparkles, ear: Ear, coffee: Coffee, gym: Dumbbell,
};
export const DEFAULT_PRESET_ICON = "sliders";
export const presetIcon = (key: string | undefined): LucideIcon => PRESET_ICONS[key ?? ""] ?? PRESET_ICONS[DEFAULT_PRESET_ICON];

/** Icônes des préréglages intégrés. */
export const BUILTIN_PRESET_ICONS: Record<string, LucideIcon> = { flat: Equal, bass: Drum, treble: Sparkles, rock: Guitar, pop: Music2, jazz: Piano, vocal: Mic };
