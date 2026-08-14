// Généré par outils/sous-ensemble-icones.py — ne pas modifier à la main.
//
// Chaque icône est rendue par son point de code, pas par son nom : la
// substitution par ligature échoue en silence si la table ne survit pas
// au découpage de la police.

export const GLYPHES = {
  archive: '\ue149',
  auto_delete: '\uea4c',
  badge: '\uea67',
  bolt: '\uea0b',
  check_circle: '\ue86c',
  dark_mode: '\ue51c',
  delete: '\ue872',
  error: '\ue000',
  event_repeat: '\ueb7b',
  hourglass_empty: '\ue88b',
  inbox: '\ue156',
  info: '\ue88e',
  key: '\ue73c',
  light_mode: '\ue518',
  login: '\uea77',
  logout: '\ue9ba',
  mail: '\ue0be',
  mail_lock: '\uec0a',
  newspaper: '\ueb81',
  palette: '\ue3b7',
  person: '\ue7fd',
  person_off: '\ue510',
  refresh: '\ue5d5',
  rule_folder: '\uf1c9',
  school: '\ue80c',
  search: '\ue8b6',
  sell: '\ue54e',
  settings: '\ue8b8',
  shield: '\ue75b',
  sync: '\ue627',
} as const

export type NomIcone = keyof typeof GLYPHES
