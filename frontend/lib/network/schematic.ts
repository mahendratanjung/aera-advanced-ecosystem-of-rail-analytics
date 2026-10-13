/**
 * The Klang Valley Integrated Transit Map as data (NETM-01): every rail line in the Klang Valley,
 * drawn the way the official Rapid KL / APAD poster draws them.
 *
 * Coordinates are in map units traced from the poster (about one unit per poster pixel at
 * 640 px wide), so the layout, bends and interchanges sit where riders expect them. Lines are
 * listed in poster order (1 to 12, then B1). Every station has an explicit position; `bend`
 * entries are corners of the drawn line, rounded when rendered.
 *
 * Rapid Rail stations use their GTFS ids (KJ15, PY20, ...) so the map links straight to the
 * timetable and the crowding model. KTM, ERL and Skypark stations are not in the Rapid Rail
 * feed; their ids (K1-09, E7-3, ...) are AERA's own and are not official codes.
 *
 * Labels: "r", "l", "t", "b" place the label beside the point (or the interchange outline),
 * optionally at a distance ("b:19"); a tuple places it at [dx, dy] from the centre with the
 * given text anchor. A "\n" in a name breaks the label, as on the poster.
 */

export type Side = "r" | "l" | "t" | "b";
export type LabelSpec = Side | `${Side}:${number}` | [number, number, "start" | "middle" | "end"];
export type Pt = [number, number];

/**
 * How much AERA knows about a line: live crowding (Kelana Jaya), a published timetable (Rapid
 * Rail and KTM GTFS), an estimate from the operator's published frequency (ERL), or a
 * suspended service with no trains.
 */
export type LineData = "live" | "timetable" | "estimate" | "suspended";

export interface StationDef {
  id: string;
  /** Display name; "\n" marks where the label breaks. */
  name: string;
  at: Pt;
  lab?: LabelSpec;
}

export interface BendDef {
  bend: Pt;
  /** Corner radius in map units (default 6). */
  r?: number;
}

export type Entry = StationDef | BendDef;

export interface LineDef {
  id: string;
  /** The number in the poster's circle. */
  badge: string;
  name: string;
  operator: string;
  mode: "KTM Komuter" | "LRT" | "MRT" | "Monorail" | "ERL" | "BRT" | "KTM";
  /** CSS custom property defined in styles/theme.css. */
  color: string;
  /** Dark text on the badge (light line colours). */
  inkBadge?: boolean;
  data: LineData;
  /** Badge circles at the termini. */
  badges: Pt[];
  path: Entry[];
}

export interface NodeDef {
  /** Interchange name, shown once for all its platforms. */
  name: string;
  ids: string[];
  lab: LabelSpec;
  /** KL Sentral: the dark hub with a dot per line, as on the poster. */
  hub?: { x: number; y: number; w: number; h: number };
}

const st = (id: string, name: string, x: number, y: number, lab?: LabelSpec): StationDef => ({ id, name, at: [x, y], lab });
const bd = (x: number, y: number, r?: number): BendDef => ({ bend: [x, y], r });

export const LINES: LineDef[] = [
  {
    id: "K1", badge: "1", name: "KTM Batu Caves – Pulau Sebang Line", operator: "KTM Berhad", mode: "KTM Komuter", color: "--line-k1",
    data: "timetable", badges: [[314.5, 148], [528, 683]],
    path: [
      st("K1-01", "Batu Caves", 314.5, 161, "r"),
      st("K1-02", "Taman\nWahyu", 314.5, 191.5, "r"),
      st("K1-03", "Kampung\nBatu", 314.5, 223, "r"),
      st("K1-04", "Batu\nKentonmen", 314.5, 241, "r"),
      st("K1-05", "Sentul", 314.5, 260.5, "r"),
      st("K1-06", "Putra", 314.5, 300),
      st("K1-07", "Bank Negara", 314.5, 326),
      st("K1-08", "Kuala Lumpur", 314.5, 405),
      st("K1-09", "KL Sentral", 314.5, 449),
      bd(314.5, 459.5, 2),
      st("K1-10", "Mid Valley", 336, 459.5, "t"),
      st("K1-11", "Seputeh", 363, 459.5, "t"),
      st("K1-12", "Salak\nSelatan", 453, 459.5, "t"),
      bd(471.5, 459.5),
      st("K1-13", "Bandar Tasik Selatan", 471.5, 486),
      bd(471.5, 503),
      bd(498, 503),
      st("K1-14", "Serdang", 498, 519, "l"),
      st("K1-15", "Kajang", 498, 539.5),
      st("K1-16", "Kajang 2", 498, 551.5, "r"),
      st("K1-17", "UKM", 498, 563.5, "r"),
      st("K1-18", "Bangi", 498, 575, "r"),
      st("K1-19", "Batang Benar", 498, 586.5, "r"),
      st("K1-20", "Nilai", 498, 598, "r"),
      st("K1-21", "Labu", 498, 609.5, "r"),
      st("K1-22", "Tiroi", 498, 621, "r"),
      st("K1-23", "Seremban", 498, 632.5, "r"),
      st("K1-24", "Senawang", 498, 644, "r"),
      st("K1-25", "Sungai Gadut", 498, 655.5, "r"),
      st("K1-26", "Rembau", 498, 667, "r"),
      bd(498, 683),
      st("K1-27", "Pulau\nSebang", 520, 683, "r:15"),
    ],
  },
  {
    id: "K2", badge: "2", name: "KTM Tanjung Malim – Pelabuhan Klang Line", operator: "KTM Berhad", mode: "KTM Komuter", color: "--line-k2",
    data: "timetable", badges: [[117.5, 161], [96, 712]],
    path: [
      st("K2-01", "Tanjung\nMalim", 109, 161, "r:14"),
      bd(90, 161),
      st("K2-02", "Kuala Kubu\nBharu", 90, 175, "l"),
      st("K2-03", "Rasa", 90, 189, "l"),
      st("K2-04", "Batang\nKali", 90, 203, "l"),
      st("K2-05", "Serendah", 90, 217, "l"),
      st("K2-06", "Rawang", 90, 231, "l"),
      bd(90, 245),
      st("K2-07", "Kuang", 122.5, 245, "t"),
      st("K2-08", "Sungai\nBuloh", 163, 245, "t"),
      bd(188, 245),
      bd(188, 173.5),
      st("K2-09", "Kepong Sentral", 232.5, 173.5, "t"),
      bd(249, 173.5),
      st("K2-10", "Kepong", 249, 231, "l"),
      st("K2-11", "Segambut", 249, 257, "l"),
      bd(249, 286),
      bd(309, 286),
      st("K2-12", "Putra", 309, 300),
      st("K2-13", "Bank Negara", 309, 326),
      st("K2-14", "Kuala Lumpur", 309, 405),
      st("K2-15", "KL Sentral", 309, 449),
      st("K2-16", "Abdullah Hukum", 309, 507),
      st("K2-17", "Angkasapuri", 309, 522, "r:10"),
      st("K2-18", "Pantai Dalam", 309, 535, "r:10"),
      bd(309, 551),
      st("K2-19", "Petaling", 280, 551, "t"),
      st("K2-20", "Jalan\nTempler", 255, 551, "t"),
      st("K2-21", "Kampung\nDato Harun", 228, 551, "t"),
      st("K2-22", "Seri Setia", 202, 551, "t"),
      bd(192, 551, 4),
      bd(182, 561.5, 4),
      st("K2-23", "Setia Jaya", 172, 561.5, "b"),
      st("K2-24", "Subang Jaya", 151, 561.5),
      bd(131.5, 561.5),
      st("K2-25", "Batu Tiga", 131.5, 571, "l"),
      st("K2-26", "Shah Alam", 131.5, 582.5, "l"),
      st("K2-27", "Padang Jawa", 131.5, 593, "l"),
      bd(131.5, 600, 4),
      bd(114, 600, 4),
      st("K2-28", "Bukit Badak", 114, 608.5, "r"),
      st("K2-29", "Klang", 114, 618.5, "r"),
      bd(114, 637),
      bd(96, 637),
      st("K2-30", "Teluk Pulai", 96, 648, "l"),
      st("K2-31", "Teluk\nGadong", 96, 661, "l"),
      st("K2-32", "Kampung\nRaja Uda", 96, 674, "l"),
      st("K2-33", "Jalan\nKastam", 96, 688, "l"),
      st("K2-34", "Pelabuhan\nKlang", 96, 702, "b:17"),
    ],
  },
  {
    id: "AG", badge: "3", name: "LRT Ampang Line", operator: "Rapid KL", mode: "LRT", color: "--line-ag",
    data: "timetable", badges: [[358.5, 197], [523, 148]],
    path: [
      st("AG1", "Sentul Timur", 358, 222.5),
      st("AG2", "Sentul", 358, 237.5),
      st("AG3", "Titiwangsa", 358, 274),
      st("AG4", "PWTC", 358, 299.5),
      st("AG5", "Sultan Ismail", 358, 312.5),
      st("AG6", "Bandaraya", 358, 325),
      st("AG7", "Masjid Jamek", 358, 352),
      bd(358, 375, 12),
      st("AG8", "Plaza Rakyat", 401.5, 375),
      st("AG9", "Hang Tuah", 442.5, 375),
      st("AG10", "Pudu", 473, 375),
      st("AG11", "Chan Sow Lin", 485.5, 375),
      bd(523, 375),
      st("AG12", "Miharja", 523, 364, "l"),
      st("AG13", "Maluri", 523, 349),
      st("AG14", "Pandan Jaya", 523, 299.5, "r"),
      st("AG15", "Pandan Indah", 523, 261.5, "r"),
      st("AG16", "Cempaka", 523, 227.5, "r"),
      st("AG17", "Cahaya", 523, 191.5, "r"),
      st("AG18", "Ampang", 523, 161, "r"),
    ],
  },
  {
    id: "SP", badge: "4", name: "LRT Sri Petaling Line", operator: "Rapid KL", mode: "LRT", color: "--line-sp",
    data: "timetable", badges: [[346.5, 197], [228.5, 706]],
    path: [
      st("SP1", "Sentul Timur", 347, 222.5),
      st("SP2", "Sentul", 347, 237.5),
      st("SP3", "Titiwangsa", 347, 274),
      st("SP4", "PWTC", 347, 299.5),
      st("SP5", "Sultan Ismail", 347, 312.5),
      st("SP6", "Bandaraya", 347, 325),
      st("SP7", "Masjid Jamek", 347, 352),
      bd(347, 386, 23),
      st("SP8", "Plaza Rakyat", 401.5, 386),
      st("SP9", "Hang Tuah", 442.5, 386),
      st("SP10", "Pudu", 473, 386),
      st("SP11", "Chan Sow Lin", 485.5, 386),
      bd(502, 386),
      st("SP12", "Cheras", 502, 401, "r"),
      bd(502, 412, 5),
      bd(485.5, 428.5, 5),
      st("SP13", "Salak Selatan", 485.5, 435, "r"),
      st("SP14", "Bandar\nTun Razak", 485.5, 447, "r"),
      st("SP15", "Bandar Tasik\nSelatan", 485.5, 461.5, "r"),
      bd(485.5, 474),
      bd(418, 474),
      st("SP16", "Sungai Besi", 418, 515.5),
      bd(418, 545),
      st("SP17", "Bukit\nJalil", 370, 545, "b"),
      st("SP18", "Sri\nPetaling", 350, 545, "b"),
      st("SP19", "Awan\nBesar", 330, 545, "b"),
      bd(297, 545),
      st("SP20", "Muhibbah", 297, 582, "r"),
      st("SP21", "Alam Sutera", 297, 595, "r"),
      st("SP22", "Kinrara BK5", 297, 610, "r"),
      st("SP24", "IOI Puchong Jaya", 297, 630, "r"),
      st("SP25", "Pusat Bandar\nPuchong", 297, 651.5, "r"),
      st("SP26", "Taman Perindustrian\nPuchong", 297, 673, "r"),
      st("SP27", "Bandar Puteri", 297, 694, "r"),
      bd(297, 717),
      st("SP28", "Puchong\nPerdana", 275, 717, "b"),
      st("SP29", "Puchong\nPrima", 251, 717, "b"),
      st("SP31", "Putra Heights", 227, 717),
    ],
  },
  {
    id: "KJ", badge: "5", name: "LRT Kelana Jaya Line", operator: "Rapid KL", mode: "LRT", color: "--line-kj",
    data: "live", badges: [[432.5, 148], [217.5, 706]],
    path: [
      st("KJ1", "Gombak", 432.5, 161, "r"),
      st("KJ2", "Taman Melati", 432.5, 178, "r"),
      st("KJ3", "Wangsa Maju", 432.5, 190, "r"),
      st("KJ4", "Sri Rampai", 432.5, 203, "r"),
      st("KJ5", "Setiawangsa", 432.5, 216, "r"),
      st("KJ6", "Jelatek", 432.5, 229, "r"),
      st("KJ7", "Dato' Keramat", 432.5, 242, "r"),
      st("KJ8", "Damai", 432.5, 255, "r"),
      st("KJ9", "Ampang\nPark", 432.5, 283, "l"),
      st("KJ10", "KLCC", 432.5, 292, "r"),
      st("KJ11", "Kampung Baru", 432.5, 300.5, "r"),
      st("KJ12", "Dang\nWangi", 432.5, 317, "l"),
      bd(432.5, 326),
      bd(392, 326),
      st("KJ13", "Masjid Jamek", 366, 352),
      bd(352, 366),
      st("KJ14", "Pasar Seni", 352, 414),
      bd(352, 420, 4),
      bd(319, 420, 4),
      bd(319, 433, 4),
      st("KJ15", "KL Sentral", 303.5, 449),
      st("KJ16", "Bangsar", 303.5, 480, "l"),
      st("KJ17", "Abdullah Hukum", 303.5, 507),
      bd(303.5, 520),
      bd(276, 520),
      st("KJ18", "Kerinchi", 276, 505, "l"),
      bd(276, 488),
      st("KJ19", "Universiti", 264, 488, "t"),
      st("KJ20", "Taman\nJaya", 245, 488, "t"),
      st("KJ21", "Asia\nJaya", 229, 488, "t"),
      st("KJ22", "Taman\nParamount", 208, 488, "t"),
      st("KJ23", "Taman\nBahagia", 184, 488, "t"),
      st("KJ24", "Kelana\nJaya", 163, 488, "t"),
      bd(146, 488),
      st("KJ25", "Lembah Subang", 146, 500.5, "r"),
      st("KJ26", "Ara Damansara", 146, 514, "r"),
      st("KJ27", "Glenmarie", 146, 528),
      st("KJ28", "Subang Jaya", 146, 561.5),
      st("KJ29", "SS 15", 146, 593, "r"),
      st("KJ30", "SS 18", 146, 603, "r"),
      bd(146, 610, 4),
      bd(162, 626, 4),
      st("KJ31", "USJ 7", 162, 634),
      st("KJ32", "Taipan", 162, 662, "r"),
      st("KJ33", "Wawasan", 162, 679, "r"),
      st("KJ34", "USJ 21", 162, 695, "r"),
      bd(162, 717),
      st("KJ35", "Alam\nMegah", 180, 717, "b"),
      st("KJ36", "Subang\nAlam", 201, 717, "b"),
      st("KJ37", "Putra Heights", 222, 717),
    ],
  },
  {
    id: "E6", badge: "6", name: "KLIA Ekspres", operator: "Express Rail Link", mode: "ERL", color: "--line-e6",
    data: "estimate", badges: [[423, 715]],
    path: [
      st("E6-1", "KL Sentral", 314.5, 469),
      bd(460.5, 469),
      st("E6-2", "KLIA T1", 460.5, 712),
      bd(460.5, 720, 4),
      st("E6-3", "KLIA T2", 434, 720),
    ],
  },
  {
    id: "E7", badge: "7", name: "KLIA Transit", operator: "Express Rail Link", mode: "ERL", color: "--line-e7",
    data: "estimate", badges: [[423, 731]],
    path: [
      st("E7-1", "KL Sentral", 314.5, 464),
      bd(466, 464),
      st("E7-2", "Bandar Tasik Selatan", 466, 486),
      st("E7-3", "Putrajaya\nSentral", 466, 671, "r"),
      st("E7-4", "Salak\nTinggi", 466, 695, "r"),
      st("E7-5", "KLIA T1", 466, 712),
      bd(466, 726, 4),
      st("E7-6", "KLIA T2", 434, 726),
    ],
  },
  {
    id: "MR", badge: "8", name: "KL Monorail Line", operator: "Rapid KL", mode: "Monorail", color: "--line-mr",
    data: "timetable", badges: [[336, 435]],
    path: [
      st("MR1", "KL Sentral", 336, 445, [6, -10, "start"]),
      bd(382, 445),
      st("MR2", "Tun\nSambanthan", 382, 432.5, "r"),
      bd(382, 420),
      st("MR3", "Maharajalela", 405, 420, "t"),
      bd(442.5, 420),
      st("MR4", "Hang Tuah", 442.5, 380.5),
      st("MR5", "Imbi", 442.5, 362, "r"),
      st("MR6", "Bukit Bintang", 442.5, 342, "r"),
      st("MR7", "Raja Chulan", 442.5, 331, "r"),
      st("MR8", "Bukit Nanas", 442.5, 320, "r"),
      bd(442.5, 308),
      st("MR9", "Medan Tuanku", 412, 308, "t"),
      bd(392, 308),
      st("MR10", "Chow\nKit", 392, 293, "l"),
      bd(392, 280),
      st("MR11", "Titiwangsa", 364, 280),
    ],
  },
  {
    id: "KG", badge: "9", name: "MRT Kajang Line", operator: "Rapid KL", mode: "MRT", color: "--line-kg",
    data: "timetable", badges: [[192, 277], [512, 527]],
    path: [
      st("KG04", "Kwasa Damansara", 182.5, 292),
      st("KG05", "Kwasa Sentral", 182.5, 311.5, "r"),
      st("KG06", "Kota Damansara", 182.5, 327.5, "r"),
      st("KG07", "Surian", 182.5, 341.5, "r"),
      st("KG08", "Mutiara Damansara", 182.5, 355, "r"),
      st("KG09", "Bandar Utama", 182.5, 370.5),
      st("KG10", "Taman Tun\nDr Ismail", 182.5, 387, "r"),
      st("KG12", "Phileo Damansara", 182.5, 405, "r"),
      bd(182.5, 425),
      st("KG13", "Pusat Bandar\nDamansara", 210.5, 425, "b"),
      st("KG14", "Semantan", 256, 425, "b"),
      st("KG15", "Muzium Negara", 285, 425, "t"),
      bd(330, 425, 4),
      bd(341, 414, 4),
      st("KG16", "Pasar Seni", 346, 414),
      bd(372, 414, 4),
      bd(390, 396, 4),
      st("KG17", "Merdeka", 401.5, 396, "b"),
      bd(415, 396),
      bd(415, 349),
      st("KG18A", "Bukit\nBintang", 428, 349, "b"),
      st("KG20", "Tun Razak Exchange", 485.5, 349),
      st("KG21", "Cochrane", 506.5, 349, "b"),
      st("KG22", "Maluri", 523, 349),
      bd(543, 349),
      st("KG23", "Taman Pertama", 543, 360, "r"),
      st("KG24", "Taman Midah", 543, 379, "r"),
      st("KG25", "Taman Mutiara", 543, 399, "r"),
      st("KG26", "Taman Connaught", 543, 418, "r"),
      st("KG27", "Taman Suntex", 543, 433, "r"),
      st("KG28", "Sri Raya", 543, 448, "r"),
      st("KG29", "Bandar Tun\nHussein Onn", 543, 461, "r"),
      st("KG30", "Batu 11\nCheras", 543, 476.5, "r"),
      st("KG31", "Bukit Dukung", 543, 494, "r"),
      st("KG33", "Sungai Jernih", 543, 508, "r"),
      st("KG34", "Stadium Kajang", 543, 524, "r"),
      bd(543, 539.5),
      st("KG35", "Kajang", 508, 539.5),
    ],
  },
  {
    id: "SK", badge: "10", name: "KTM KL Sentral – Terminal Skypark Line", operator: "KTM Berhad", mode: "KTM", color: "--line-sk",
    data: "suspended", badges: [[82.5, 459.5]],
    path: [
      st("SK-1", "KL Sentral", 314.5, 449),
      bd(314.5, 556),
      st("SK-2", "Subang Jaya", 151, 556),
      bd(112, 556),
      bd(112, 459.5),
      st("SK-3", "Terminal\nSkypark", 94, 459.5, "b:7"),
    ],
  },
  {
    id: "SA", badge: "11", name: "LRT Shah Alam Line", operator: "Rapid KL", mode: "LRT", color: "--line-sa",
    data: "timetable", badges: [[164, 360], [150, 727]],
    path: [
      st("SA1", "Bandar Utama", 176, 370.5),
      bd(140, 370.5),
      st("SA2", "Kayu Ara", 140, 394, "r"),
      st("SA3", "BU 11", 140, 409, "r"),
      st("SA5", "Damansara\nIdaman", 140, 424, "r"),
      st("SA6", "SS 7", 140, 440, "r"),
      st("SA7", "Glenmarie 2", 140, 528),
      bd(140, 537),
      st("SA9", "Kerjaya", 124, 537, "b"),
      st("SA10", "Stadium\nShah\nAlam", 101, 537, "t"),
      bd(90, 537),
      st("SA12", "Dato'\nMenteri", 90, 548, "l"),
      st("SA14", "UiTM\nShah Alam", 90, 561, "l"),
      st("SA15", "Seksyen 7\nShah Alam", 90, 574, "l"),
      st("SA17", "Bandar\nBaru Klang", 90, 588, "l"),
      st("SA18", "Pasar\nKlang", 90, 601, "l"),
      st("SA19", "Jalan\nMeru", 90, 614, "l"),
      bd(90, 627),
      st("SA20", "Pasar\nJawa", 122, 627, "b"),
      bd(150, 627),
      st("SA21", "Taman\nSelatan", 150, 643, "l"),
      st("SA22", "Seri Andalas", 150, 655, "l"),
      st("SA23", "Klang Jaya", 150, 670, "l"),
      st("SA24", "Bandar\nBukit Tinggi", 150, 686, "l"),
      st("SA26", "Johan\nSetia", 150, 717, "b:17"),
    ],
  },
  {
    id: "PY", badge: "12", name: "MRT Putrajaya Line", operator: "Rapid KL", mode: "MRT", color: "--line-py", inkBadge: true,
    data: "timetable", badges: [[202, 277], [420, 691]],
    path: [
      st("PY01", "Kwasa Damansara", 182.5, 286),
      st("PY03", "Kampung\nSelamat", 182.5, 274, "l"),
      st("PY04", "Sungai\nBuloh", 182.5, 259, "l"),
      st("PY05", "Damansara\nDamai", 182.5, 220, "l"),
      st("PY06", "Sri Damansara\nBarat", 182.5, 203, "l"),
      bd(182.5, 183.5),
      st("PY07", "Sri\nDamansara\nSentral", 205, 183.5, "b"),
      st("PY08", "Sri\nDamansara\nTimur", 232.5, 183.5, "b"),
      st("PY09", "Metro\nPrima", 259, 183.5, "b"),
      st("PY10", "Kepong\nBaru", 276, 183.5, "b"),
      st("PY11", "Jinjang", 293, 183.5, "b"),
      bd(306, 183.5),
      st("PY12", "Sri Delima", 306, 209, "l"),
      st("PY13", "Kampung\nBatu", 306, 223, "l"),
      st("PY14", "Kentonmen", 306, 241, "l"),
      st("PY15", "Jalan Ipoh", 306, 255.5, "l"),
      st("PY16", "Sentul Barat", 306, 265, "l"),
      bd(306, 274, 4),
      st("PY17", "Titiwangsa", 352.5, 274),
      st("PY18", "Hospital\nKuala\nLumpur", 406, 274, "t"),
      st("PY19", "Raja\nUda", 423, 274, "t"),
      st("PY20", "Ampang\nPark", 441, 274, [5, -6, "start"]),
      bd(485.5, 274),
      st("PY21", "Persiaran\nKLCC", 485.5, 298, "r"),
      st("PY22", "Conlay", 485.5, 315, "r"),
      st("PY23", "Tun Razak Exchange", 485.5, 349),
      st("PY24", "Chan Sow Lin", 485.5, 380.5),
      bd(485.5, 392),
      st("PY27", "Kuchai", 397, 480.5, "l:5"),
      bd(390, 487.5, 4),
      st("PY28", "Taman\nNaga Emas", 404, 501.5, "l:7"),
      st("PY29", "Sungai Besi", 418, 515.5),
      bd(442.5, 540),
      st("PY31", "Serdang Raya Utara", 442.5, 563, "l"),
      st("PY32", "Serdang Raya Selatan", 442.5, 575.5, "l"),
      st("PY33", "Serdang Jaya", 442.5, 588, "l"),
      st("PY34", "UPM", 442.5, 600, "l"),
      st("PY36", "Taman Equine", 442.5, 613, "l"),
      st("PY37", "Putra Permai", 442.5, 625.5, "l"),
      st("PY38", "16 Sierra", 442.5, 638, "l"),
      st("PY39", "Cyberjaya Utara", 442.5, 650, "l"),
      st("PY40", "Cyberjaya City Centre", 442.5, 662.5, "l"),
      bd(442.5, 671),
      st("PY41", "Putrajaya\nSentral", 453, 671, [-3, 14, "end"]),
    ],
  },
  {
    id: "BRT", badge: "B1", name: "BRT Sunway Line", operator: "Rapid KL", mode: "BRT", color: "--line-brt",
    data: "timetable", badges: [[195, 569]],
    path: [
      st("BRT1", "Sunway–Setia Jaya", 195, 580, "r"),
      bd(195, 590.5),
      st("BRT2", "Mentari", 213, 590.5, "b"),
      st("BRT3", "Sunway\nLagoon", 238, 590.5, "b"),
      bd(257, 590.5),
      st("BRT4", "SunMed", 257, 611, "r"),
      bd(257, 634),
      st("BRT5", "SunU–\nMonash", 240, 634, "b"),
      st("BRT6", "South Quay\n–USJ 1", 206, 634, "b"),
      st("BRT7", "USJ 7", 167, 634),
    ],
  },
];

/** Platforms of one interchange, drawn inside one outline with one label. */
export const NODES: NodeDef[] = [
  { name: "Putra", ids: ["K2-12", "K1-06"], lab: "l" },
  { name: "Bank Negara", ids: ["K2-13", "K1-07"], lab: "l" },
  { name: "Kuala Lumpur", ids: ["K2-14", "K1-08"], lab: "l" },
  { name: "KL Sentral", ids: ["K1-09", "K2-15", "KJ15", "SK-1", "E6-1", "E7-1"], lab: [-14, 0, "end"], hub: { x: 300, y: 430, w: 19, h: 44 } },
  { name: "Abdullah\nHukum", ids: ["KJ17", "K2-16"], lab: "l:1.5" },
  { name: "Subang\nJaya", ids: ["KJ28", "K2-24", "SK-2"], lab: [4, -13, "start"] },
  { name: "Bandar Tasik\nSelatan", ids: ["K1-13", "E7-2"], lab: "r" },
  { name: "Kajang", ids: ["K1-15", "KG35"], lab: "l" },
  { name: "KLIA", ids: ["E6-2", "E7-5"], lab: "r" },
  { name: "KLIA2", ids: ["E6-3", "E7-6"], lab: "b" },
  { name: "Sentul\nTimur", ids: ["SP1", "AG1"], lab: "t" },
  { name: "Sentul", ids: ["SP2", "AG2"], lab: "r" },
  { name: "Titiwangsa", ids: ["SP3", "AG3", "PY17", "MR11"], lab: [8, -9, "start"] },
  { name: "PWTC", ids: ["SP4", "AG4"], lab: "r" },
  { name: "Sultan Ismail", ids: ["SP5", "AG5"], lab: "r" },
  { name: "Bandaraya", ids: ["SP6", "AG6"], lab: "r" },
  { name: "Masjid\nJamek", ids: ["SP7", "AG7", "KJ13"], lab: "l" },
  { name: "Plaza\nRakyat", ids: ["AG8", "SP8"], lab: "t" },
  { name: "Hang\nTuah", ids: ["AG9", "SP9", "MR4"], lab: [5, 13, "start"] },
  { name: "Pudu", ids: ["AG10", "SP10"], lab: "t" },
  { name: "Chan Sow Lin", ids: ["AG11", "PY24", "SP11"], lab: [6, 0, "start"] },
  { name: "Tun Razak\nExchange", ids: ["PY23", "KG20"], lab: [-4, 7.8, "end"] },
  { name: "Maluri", ids: ["AG13", "KG22"], lab: [5, -6, "start"] },
  { name: "Pasar\nSeni", ids: ["KG16", "KJ14"], lab: [6, -8, "start"] },
  { name: "Sungai\nBesi", ids: ["SP16", "PY29"], lab: [6, -5, "start"] },
  { name: "Putra\nHeights", ids: ["KJ37", "SP31"], lab: "b" },
  { name: "USJ 7", ids: ["KJ31", "BRT7"], lab: [5, 10, "start"] },
  { name: "Glenmarie", ids: ["KJ27", "SA7"], lab: "r" },
  { name: "Bandar\nUtama", ids: ["KG09", "SA1"], lab: "r" },
  { name: "Kwasa\nDamansara", ids: ["PY01", "KG04"], lab: "r" },
];

/** Separate stations joined by a walkway (the poster's grey "connecting station" link). */
export const LINKS: [string, string][] = [
  ["K2-08", "PY04"], // Sungai Buloh
  ["K2-09", "PY08"], // Kepong Sentral, Sri Damansara Timur
  ["K1-03", "PY13"], // Kampung Batu
  ["K1-04", "PY14"], // Batu Kentonmen, Kentonmen
  ["K1-06", "SP4"], // Putra, PWTC
  ["K1-07", "SP6"], // Bank Negara, Bandaraya
  ["K1-08", "KG16"], // Kuala Lumpur, Pasar Seni
  ["KG15", "K2-15"], // Muzium Negara, KL Sentral
  ["MR1", "K1-09"], // KL Sentral monorail
  ["KJ9", "PY20"], // Ampang Park
  ["KJ12", "MR8"], // Dang Wangi, Bukit Nanas
  ["KG18A", "MR6"], // Bukit Bintang
  ["SP8", "KG17"], // Plaza Rakyat, Merdeka
  ["SP15", "K1-13"], // Bandar Tasik Selatan
  ["PY41", "E7-3"], // Putrajaya Sentral
  ["K2-23", "BRT1"], // Setia Jaya, Sunway–Setia Jaya
];

/** The poster's extent, with room for labels. */
export const BOUNDS = { x: 44, y: 138, w: 562, h: 612 };
