const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const LOOKUP_TIMEOUT_MS = 8000;

const SERVICE_CITIES = [
  'Baco',
  'Bansud',
  'Bongabong',
  'Bulalacao',
  'Calapan City',
  'Gloria',
  'Mansalay',
  'Naujan',
  'Pinamalayan',
  'Pola',
  'Puerto Galera',
  'Roxas',
  'San Teodoro',
  'Socorro',
  'Victoria',
];

const CITY_COORDINATES = {
  Baco: { lat: 13.2, lng: 121.12 },
  Bansud: { lat: 12.86, lng: 121.16 },
  Bongabong: { lat: 12.74, lng: 121.14 },
  Bulalacao: { lat: 12.32, lng: 121.35 },
  'Calapan City': { lat: 13.41, lng: 121.18 },
  Gloria: { lat: 12.94, lng: 121.42 },
  Mansalay: { lat: 12.5, lng: 121.42 },
  Naujan: { lat: 13.24, lng: 121.28 },
  Pinamalayan: { lat: 13.04, lng: 121.51 },
  Pola: { lat: 13.11, lng: 121.44 },
  'Puerto Galera': { lat: 13.51, lng: 120.97 },
  Roxas: { lat: 12.6, lng: 121.35 },
  'San Teodoro': { lat: 13.04, lng: 121.29 },
  Socorro: { lat: 13.08, lng: 121.42 },
  Victoria: { lat: 13.14, lng: 121.18 },
};

export function coordinatesForCity(city) {
  return CITY_COORDINATES[city] || CITY_COORDINATES.Victoria;
}

function formatAddress(result, serviceCities) {
  const address = result.address || {};
  const supported = serviceCities.length ? serviceCities : SERVICE_CITIES;
  const city =
    [
      address.municipality,
      address.city,
      address.town,
      address.village,
      address.city_district,
      address.suburb,
      address.county,
      ...Object.values(address),
    ]
      .map((value) =>
        supported.find(
          (item) => item.toLowerCase() === String(value || '').trim().toLowerCase()
        )
      )
      .find(Boolean) || '';

  const streetParts = [
    [address.house_number, address.road].filter(Boolean).join(' '),
    address.building,
    address.neighbourhood,
    address.suburb,
    address.quarter,
    address.hamlet,
    address.village,
    address.residential,
  ]
    .map((part) => String(part || '').trim())
    .filter((part) => part && part.toLowerCase() !== city.toLowerCase())
    .filter((part, index, parts) => parts.findIndex((item) => item.toLowerCase() === part.toLowerCase()) === index);

  return {
    address: streetParts.join(', ') || result.display_name || '',
    city,
  };
}

export async function reverseGeocode(lat, lng, serviceCities = []) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      zoom: '18',
      lat: String(lat),
      lon: String(lng),
    });
    const response = await fetch(`${NOMINATIM_URL}?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Address lookup failed (${response.status})`);
    const result = await response.json();
    return formatAddress(result, serviceCities);
  } finally {
    window.clearTimeout(timeout);
  }
}
