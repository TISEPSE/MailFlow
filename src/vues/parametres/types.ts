import type { NomIcone } from '../../composants/glyphes'

export const TEINTE_REFUS = '#C2410C'

export const ACCENTS = ['#2F6BFF', '#1F7A5A', '#4C3BCF', '#C2410C'] as const

export type OngletParametres = 'compte' | 'apparence' | 'sync' | 'ia' | 'aide'

export interface DefOnglet {
  id: OngletParametres
  label: string
  icone: NomIcone
  description: string
}

export const ONGLETS: DefOnglet[] = [
  {
    id: 'compte',
    label: 'Compte & Profil',
    icone: 'person',
    description: 'Gestion du compte Google connecté et des préférences de lecture',
  },
  {
    id: 'apparence',
    label: 'Apparence',
    icone: 'palette',
    description: 'Thème d’affichage et personnalisation des couleurs d’accent',
  },
  {
    id: 'sync',
    label: 'Synchronisation',
    icone: 'sync',
    description: 'Fréquence de relevé Gmail et exécution des règles automatiques',
  },
  {
    id: 'ia',
    label: 'Intelligence Artificielle',
    icone: 'auto_awesome',
    description: 'Clé API Gemini, synthèses de newsletters et gestion du cache',
  },
  {
    id: 'aide',
    label: 'Aide & Diagnostic',
    icone: 'info',
    description: 'Guide de prise en main, diagnostics et état des services',
  },
]
