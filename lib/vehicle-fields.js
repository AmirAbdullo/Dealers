'use strict';

function currentYear() {
  return new Date().getFullYear();
}

/** Lenient validation for PATCH /api/vehicles/:id (draft auto-save). */
function applyDraftPatchFromBody(body) {
  const updates = {};
  const errors = [];
  const b = body || {};
  const thisYear = currentYear();

  if ('chassis_number' in b || 'vin' in b) {
    const raw = String(b.chassis_number != null ? b.chassis_number : b.vin || '').trim();
    const vin = raw ? raw.toUpperCase() : '';
    if (vin && !/^[A-Z0-9]{1,17}$/i.test(vin)) {
      errors.push('chassis_number must be alphanumeric, up to 17 characters');
    } else {
      updates.vin = vin;
    }
  }

  if ('status' in b) {
    const status = String(b.status || '').trim().toLowerCase();
    if (status === 'active') {
      errors.push('Use POST /api/vehicles/:id/publish to publish a listing');
    } else {
      updates.status = 'draft';
    }
  }

  if ('make' in b) {
    updates.make = String(b.make == null ? '' : b.make).trim();
  }

  if ('model' in b) {
    updates.model = String(b.model == null ? '' : b.model).trim();
  }

  if ('year' in b) {
    const v = b.year;
    if (v === null || v === undefined) {
      updates.year = 0;
    } else if (v === '') {
      updates.year = 0;
    } else {
      const year = Number(v);
      if (isNaN(year)) {
        errors.push('year must be a number');
      } else if (year !== 0 && (year < 1900 || year > thisYear + 1)) {
        errors.push('year is out of range');
      } else {
        updates.year = year;
      }
    }
  }

  if ('mileage' in b) {
    const v = b.mileage;
    if (v === null || v === undefined) {
      updates.mileage = 0;
    } else if (v === '') {
      updates.mileage = 0;
    } else {
      const mileage = Number(v);
      if (!Number.isInteger(mileage) || mileage < 0) {
        errors.push('mileage must be a non-negative integer');
      } else {
        updates.mileage = mileage;
      }
    }
  }

  if ('price' in b) {
    const v = b.price;
    if (v === null || v === undefined) {
      updates.price = 0;
    } else if (v === '') {
      updates.price = 0;
    } else {
      const price = Number(v);
      if (!Number.isInteger(price) || price < 0) {
        errors.push('price must be a non-negative integer (cents)');
      } else {
        updates.price = price;
      }
    }
  }

  if ('trim' in b) {
    const trim = b.trim == null ? '' : String(b.trim).trim();
    updates.trim = trim || null;
  }

  if ('body_type' in b) {
    const v = b.body_type == null ? '' : String(b.body_type).trim();
    updates.body_type = v || null;
  }

  if ('transmission' in b) {
    const v = b.transmission == null ? '' : String(b.transmission).trim();
    updates.transmission = v || null;
  }

  if ('fuel_type' in b) {
    const v = b.fuel_type == null ? '' : String(b.fuel_type).trim();
    updates.fuel_type = v || null;
  }

  if ('exterior_color' in b) {
    const v = b.exterior_color == null ? '' : String(b.exterior_color).trim();
    updates.exterior_color = v || null;
  }

  if ('interior_color' in b) {
    const v = b.interior_color == null ? '' : String(b.interior_color).trim();
    updates.interior_color = v || null;
  }

  if ('description' in b) {
    const v = b.description == null ? '' : String(b.description).trim();
    updates.description = v || null;
  }

  return { updates: updates, errors: errors };
}

/** Strict validation for POST /api/vehicles/:id/publish. */
function validateForPublish(vehicle, photoCount) {
  const missing = [];

  if (!String(vehicle.make || '').trim()) missing.push('make');
  if (!String(vehicle.model || '').trim()) missing.push('model');

  const year = Number(vehicle.year);
  if (!year || isNaN(year) || year < 1900 || year > currentYear() + 1) {
    missing.push('year');
  }

  const mileage = Number(vehicle.mileage);
  if (!Number.isInteger(mileage) || mileage <= 0) {
    missing.push('mileage');
  }

  const price = Number(vehicle.price);
  if (!Number.isInteger(price) || price <= 0) {
    missing.push('price');
  }

  if (!photoCount || photoCount < 1) {
    missing.push('photos');
  }

  if (missing.length === 0) {
    return null;
  }

  return {
    error: 'Cannot publish',
    missing: missing
  };
}

module.exports = {
  applyDraftPatchFromBody,
  validateForPublish,
  currentYear,
};
