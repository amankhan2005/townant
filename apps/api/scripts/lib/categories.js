// The starting category taxonomy. Categories are platform configuration (not listings), and
// Super Admins can edit them afterwards. Upserts by slug with $setOnInsert, so re-running never
// changes or duplicates a category that already exists.
import { Category } from '../../src/models/index.js';

export const CATEGORIES = [
  ['Home Services', 'home-services', 'home', [['Handyman', 'handyman'], ['Moving & Packing', 'moving'], ['Landscaping', 'landscaping']]],
  ['Cleaning', 'cleaning', 'sparkles', [['House Cleaning', 'house-cleaning'], ['Carpet & Upholstery', 'carpet-cleaning']]],
  ['Beauty & Salon', 'beauty-salon', 'scissors', [['Hair', 'hair'], ['Nails', 'nails'], ['Barber', 'barber']]],
  ['Health & Wellness', 'health-wellness', 'heart-pulse', [['Massage', 'massage'], ['Dental', 'dental'], ['Physiotherapy', 'physiotherapy']]],
  ['Repairs & Maintenance', 'repairs-maintenance', 'wrench', [['Plumbing', 'plumbing'], ['Electrical', 'electrical'], ['Appliance Repair', 'appliance-repair']]],
  ['Automotive', 'automotive', 'car', [['Car Wash & Detailing', 'car-detailing'], ['Mechanic', 'mechanic']]],
  ['Pet Care', 'pet-care', 'paw', [['Grooming', 'pet-grooming'], ['Pet Sitting', 'pet-sitting']]],
  ['Fitness', 'fitness', 'dumbbell', [['Personal Training', 'personal-training'], ['Yoga', 'yoga']]],
  ['Lessons & Tutoring', 'lessons-tutoring', 'book', [['Academic Tutoring', 'tutoring'], ['Music Lessons', 'music-lessons']]],
  ['Events', 'events', 'party', [['Photography', 'photography'], ['Catering', 'catering']]],
];

export async function seedCategories() {
  let order = 0;
  for (const [name, slug, icon, children] of CATEGORIES) {
    const parent = await Category.findOneAndUpdate({ slug }, { $setOnInsert: { name, slug, icon, sortOrder: (order += 10) } }, { upsert: true, new: true });
    let childOrder = 0;
    for (const [childName, childSlug] of children) {
      await Category.updateOne({ slug: childSlug }, { $setOnInsert: { name: childName, slug: childSlug, icon, parentId: parent._id, sortOrder: (childOrder += 10) } }, { upsert: true });
    }
  }
  return Category.countDocuments();
}
