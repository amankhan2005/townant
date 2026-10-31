import { createElement } from 'react';
import { BookOpen, Car, Dumbbell, HeartPulse, Home, LayoutGrid, PartyPopper, PawPrint, Scissors, Sparkles, Wrench } from 'lucide-react';

// Category icon keys are chosen by Super Admins; unknown keys fall back to a neutral grid.
const CATEGORY_ICONS = { home: Home, sparkles: Sparkles, scissors: Scissors, 'heart-pulse': HeartPulse, wrench: Wrench, car: Car, paw: PawPrint, dumbbell: Dumbbell, book: BookOpen, party: PartyPopper };

export const CATEGORY_ICON_KEYS = Object.keys(CATEGORY_ICONS);

export const categoryIcon = (key) => CATEGORY_ICONS[key] ?? LayoutGrid;

// Renders the line icon for a category's icon key.
export const CategoryIcon = ({ name, ...props }) => createElement(categoryIcon(name), props);
