'use strict';

const MAKES = [
  'Toyota', 'Hyundai', 'Kia', 'Nissan', 'Honda', 'Mitsubishi', 'Mazda', 'Suzuki',
  'BAIC', 'Geely', 'Chery', 'MG', 'Haval', 'BYD', 'JAC', 'Dongfeng', 'Brilliance', 'Lada',
  'Ford', 'Chevrolet', 'Renault', 'Peugeot', 'Citroën', 'Volkswagen', 'BMW',
  'Mercedes-Benz', 'Audi', 'Lexus', 'Mini', 'Land Rover', 'Jeep', 'Dodge',
  'Chrysler', 'GMC', 'Cadillac', 'Infiniti', 'Acura', 'Volvo', 'Skoda', 'Seat',
  'Fiat', 'Opel', 'Subaru', 'Tesla', 'Genesis'
];

/** Popular MENA models for the top 15 makes; other makes fall back to free-text model in the UI. */
const MODELS_BY_MAKE = {
  Toyota: [
    'Camry', 'Corolla', 'Land Cruiser', 'Prado', 'Hilux', 'RAV4', 'Yaris', 'Avalon',
    '4Runner', 'Highlander', 'Fortuner', 'Innova', 'C-HR', 'Supra', 'FJ Cruiser'
  ],
  Hyundai: [
    'Elantra', 'Sonata', 'Accent', 'Tucson', 'Santa Fe', 'Creta', 'Kona', 'i10',
    'i20', 'i30', 'Veloster', 'Genesis', 'Palisade', 'Venue', 'Azera'
  ],
  Kia: [
    'Rio', 'Cerato', 'Optima', 'Sportage', 'Sorento', 'Picanto', 'Soul', 'Forte',
    'Carnival', 'Stinger', 'Seltos', 'Telluride', 'K5', 'Niro'
  ],
  Nissan: [
    'Altima', 'Sentra', 'Maxima', 'Patrol', 'X-Trail', 'Pathfinder', 'Kicks', 'Juke',
    'Navara', 'Sunny', 'Tiida', 'Murano', 'Armada', 'Z'
  ],
  Honda: [
    'Accord', 'Civic', 'CR-V', 'Pilot', 'City', 'HR-V', 'Odyssey', 'Fit',
    'Ridgeline', 'Passport', 'Insight'
  ],
  Mitsubishi: [
    'Lancer', 'Outlander', 'Pajero', 'Montero', 'ASX', 'Eclipse Cross', 'Attrage',
    'Mirage', 'L200', 'Galant'
  ],
  Mazda: [
    'Mazda3', 'Mazda6', 'CX-3', 'CX-5', 'CX-9', 'CX-30', 'MX-5', 'BT-50', 'CX-60'
  ],
  Suzuki: [
    'Swift', 'Vitara', 'Jimny', 'Grand Vitara', 'Ciaz', 'Ertiga', 'Baleno', 'Alto',
    'Dzire', 'S-Cross'
  ],
  Ford: [
    'Focus', 'Fusion', 'Mustang', 'Explorer', 'Expedition', 'F-150', 'Ranger',
    'Edge', 'Escape', 'Bronco', 'Taurus', 'EcoSport'
  ],
  Chevrolet: [
    'Malibu', 'Impala', 'Cruze', 'Captiva', 'Tahoe', 'Suburban', 'Silverado',
    'Traverse', 'Equinox', 'Camaro', 'Corvette', 'Spark', 'Trailblazer'
  ],
  Renault: [
    'Logan', 'Symbol', 'Duster', 'Megane', 'Fluence', 'Koleos', 'Captur', 'Clio',
    'Sandero', 'Talisman', 'Kadjar'
  ],
  Peugeot: [
    '206', '207', '301', '308', '408', '508', '2008', '3008', '5008', 'Partner',
    'Boxer', 'RCZ'
  ],
  'Citroën': [
    'C3', 'C4', 'C5', 'Berlingo', 'C-Elysee', 'DS3', 'DS4', 'C4 Cactus', 'C3 Aircross',
    'C5 Aircross'
  ],
  Volkswagen: [
    'Golf', 'Jetta', 'Passat', 'Tiguan', 'Touareg', 'Polo', 'Beetle', 'Arteon',
    'Teramont', 'T-Roc', 'Amarok'
  ],
  BMW: [
    '3 Series', '5 Series', '7 Series', 'X1', 'X3', 'X5', 'X6', 'X7', '1 Series',
    '2 Series', '4 Series', 'M3', 'M5'
  ],
  BAIC: ['X25', 'X35', 'X55', 'X75', 'MZ45', 'MZ45 Pro', 'BJ20', 'BJ40', 'EU5', 'D20'],
  Geely: ['Emgrand', 'Emgrand X7', 'GX3 Pro', 'Coolray', 'Azkarra', 'Okavango', 'Monjaro', 'Tugella', 'Vision'],
  Chery: ['Tiggo 4', 'Tiggo 7', 'Tiggo 8', 'Arrizo 5', 'Arrizo 6', 'Arrizo 7', 'Tiggo 4 Pro', 'Tiggo 7 Pro', 'Tiggo 8 Pro'],
  MG: ['MG5', 'MG6', 'ZS', 'HS', 'RX5', 'MG3', 'Cyberster', 'MG4'],
  Haval: ['H2', 'H6', 'Jolion', 'Dargo', 'F7', 'F7x', 'H9'],
  BYD: ['F3', 'F0', 'S6', 'Tang', 'Han', 'Atto 3', 'Seal', 'Dolphin'],
  JAC: ['J7', 'S3', 'S4', 'S7', 'iEV6E', 'T8', 'X200'],
  Dongfeng: ['AX7', 'AX4', 'Forthing T5', 'Fengshen E70', 'Box'],
  Brilliance: ['V3', 'V5', 'H230', 'H320', 'H530', 'FRV', 'Jinbei'],
  Lada: ['Niva', 'Vesta', 'Granta', 'Largus', '2107', '2106', 'Priora'],
  Seat: ['Ibiza', 'Leon', 'Arona', 'Ateca', 'Tarraco', 'Mii'],
  Opel: ['Astra', 'Corsa', 'Insignia', 'Mokka', 'Crossland', 'Grandland', 'Zafira', 'Vectra']
};

function getModelsForMake(make) {
  const key = String(make || '').trim();
  if (!key) return [];
  return MODELS_BY_MAKE[key] ? MODELS_BY_MAKE[key].slice() : [];
}

const EGYPT_GOVERNORATES = [
  'القاهرة', 'الجيزة', 'الإسكندرية', 'الشرقية', 'الدقهلية',
  'البحيرة', 'المنوفية', 'الغربية', 'الفيوم', 'بني سويف',
  'المنيا', 'أسيوط', 'سوهاج', 'قنا', 'الأقصر', 'أسوان',
  'البحر الأحمر', 'الوادي الجديد', 'مطروح', 'شمال سيناء',
  'جنوب سيناء', 'بورسعيد', 'الإسماعيلية', 'السويس', 'دمياط',
  'كفر الشيخ', 'القليوبية'
];

module.exports = { MAKES, MODELS_BY_MAKE, getModelsForMake, EGYPT_GOVERNORATES };
