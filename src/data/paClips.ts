// GENERADO POR scripts/build-pa.mjs — NO EDITAR A MANO.
//
// Las posiciones de este fichero indexan los sprites de public/audio/pa/. Los
// dos salen del mismo comando a propósito: si se regenera el audio sin
// regenerar esta tabla, cada aviso empieza a decir la sílaba equivocada.
//
// Regenerar con:  npm run pa:build

/** Dónde vive cada recorte dentro de su sprite, en segundos. */
export interface ClipSlice {
  at: number
  dur: number
}

/** Hueco entre las dos repeticiones del nombre, como respira un aviso de verdad. */
export const NAME_REPEAT_GAP = 0.25

export type PaLang = 'ja' | 'es' | 'en'

/** Which sprite each station's name lives in — the arc index, from its position on the ring. */
export const ARC_SIZE = 6

export const PA_CLIPS: Record<PaLang, Record<string, Record<string, ClipSlice>>> =
{
  "ja": {
    "frag": {
      "next": {
        "at": 0,
        "dur": 0.444
      },
      "soon": {
        "at": 0.544,
        "dur": 0.646
      },
      "doors": {
        "at": 1.29,
        "dur": 1.236
      },
      "left": {
        "at": 2.626,
        "dur": 0.72
      },
      "right": {
        "at": 3.446,
        "dur": 0.565
      },
      "end": {
        "at": 4.111,
        "dur": 0.319
      },
      "closing": {
        "at": 4.529,
        "dur": 2.487
      }
    },
    "name0": {
      "tokyo": {
        "at": 0,
        "dur": 0.64
      },
      "yokohama": {
        "at": 0.74,
        "dur": 0.623
      },
      "susukino": {
        "at": 1.463,
        "dur": 0.53
      },
      "nishiki": {
        "at": 2.093,
        "dur": 0.472
      },
      "nara": {
        "at": 2.665,
        "dur": 0.275
      },
      "koyasan": {
        "at": 3.039,
        "dur": 0.819
      }
    },
    "name1": {
      "kanazawa": {
        "at": 0,
        "dur": 0.692
      },
      "takayama": {
        "at": 0.792,
        "dur": 0.675
      },
      "uji": {
        "at": 1.567,
        "dur": 0.268
      },
      "kiyomizu": {
        "at": 1.934,
        "dur": 0.68
      },
      "shirakawa-go": {
        "at": 2.714,
        "dur": 0.895
      },
      "arashiyama": {
        "at": 3.71,
        "dur": 0.709
      }
    },
    "name2": {
      "fukuoka": {
        "at": 0,
        "dur": 0.561
      },
      "karuizawa": {
        "at": 0.661,
        "dur": 0.761
      },
      "hiroshima": {
        "at": 1.522,
        "dur": 0.616
      },
      "chukagai": {
        "at": 2.238,
        "dur": 0.677
      },
      "nagoya": {
        "at": 3.014,
        "dur": 0.46
      },
      "sendai": {
        "at": 3.575,
        "dur": 0.573
      }
    },
    "name3": {
      "fushimi-inari": {
        "at": 0,
        "dur": 0.828
      },
      "dotonbori": {
        "at": 0.928,
        "dur": 0.831
      },
      "otaru": {
        "at": 1.859,
        "dur": 0.419
      },
      "yoshino": {
        "at": 2.378,
        "dur": 0.471
      },
      "shizuoka": {
        "at": 2.948,
        "dur": 0.64
      },
      "kawasaki": {
        "at": 3.688,
        "dur": 0.727
      }
    },
    "name4": {
      "kamakura": {
        "at": 0,
        "dur": 0.622
      },
      "enoshima": {
        "at": 0.722,
        "dur": 0.565
      },
      "himeji": {
        "at": 1.387,
        "dur": 0.488
      },
      "kobe": {
        "at": 1.975,
        "dur": 0.494
      },
      "shinsekai": {
        "at": 2.569,
        "dur": 0.756
      },
      "ginza": {
        "at": 3.425,
        "dur": 0.466
      }
    }
  },
  "es": {
    "frag": {
      "next": {
        "at": 0,
        "dur": 1.106
      },
      "soon": {
        "at": 1.206,
        "dur": 0.624
      },
      "doors": {
        "at": 1.93,
        "dur": 1.609
      },
      "left": {
        "at": 3.64,
        "dur": 0.588
      },
      "right": {
        "at": 4.328,
        "dur": 0.576
      },
      "closing": {
        "at": 5.004,
        "dur": 1.238
      }
    },
    "name0": {
      "tokyo": {
        "at": 0,
        "dur": 0.408
      },
      "yokohama": {
        "at": 0.508,
        "dur": 0.704
      },
      "susukino": {
        "at": 1.313,
        "dur": 0.7
      },
      "nishiki": {
        "at": 2.112,
        "dur": 0.611
      },
      "nara": {
        "at": 2.823,
        "dur": 0.379
      },
      "koyasan": {
        "at": 3.302,
        "dur": 0.619
      }
    },
    "name1": {
      "kanazawa": {
        "at": 0,
        "dur": 0.677
      },
      "takayama": {
        "at": 0.777,
        "dur": 0.629
      },
      "uji": {
        "at": 1.506,
        "dur": 0.402
      },
      "kiyomizu": {
        "at": 2.008,
        "dur": 0.643
      },
      "shirakawa-go": {
        "at": 2.751,
        "dur": 0.827
      },
      "arashiyama": {
        "at": 3.678,
        "dur": 0.74
      }
    },
    "name2": {
      "fukuoka": {
        "at": 0,
        "dur": 0.613
      },
      "karuizawa": {
        "at": 0.713,
        "dur": 0.689
      },
      "hiroshima": {
        "at": 1.502,
        "dur": 0.681
      },
      "chukagai": {
        "at": 2.283,
        "dur": 0.567
      },
      "nagoya": {
        "at": 2.95,
        "dur": 0.565
      },
      "sendai": {
        "at": 3.614,
        "dur": 0.491
      }
    },
    "name3": {
      "fushimi-inari": {
        "at": 0,
        "dur": 0.88
      },
      "dotonbori": {
        "at": 0.98,
        "dur": 0.623
      },
      "otaru": {
        "at": 1.702,
        "dur": 0.438
      },
      "yoshino": {
        "at": 2.24,
        "dur": 0.612
      },
      "shizuoka": {
        "at": 2.951,
        "dur": 0.665
      },
      "kawasaki": {
        "at": 3.716,
        "dur": 0.689
      }
    },
    "name4": {
      "kamakura": {
        "at": 0,
        "dur": 0.573
      },
      "enoshima": {
        "at": 0.673,
        "dur": 0.624
      },
      "himeji": {
        "at": 1.397,
        "dur": 0.519
      },
      "kobe": {
        "at": 2.015,
        "dur": 0.294
      },
      "shinsekai": {
        "at": 2.409,
        "dur": 0.723
      },
      "ginza": {
        "at": 3.232,
        "dur": 0.531
      }
    }
  },
  "en": {
    "frag": {
      "next": {
        "at": 0,
        "dur": 1.254
      },
      "soon": {
        "at": 1.354,
        "dur": 1.245
      },
      "doors": {
        "at": 2.699,
        "dur": 1.25
      },
      "left": {
        "at": 4.048,
        "dur": 0.759
      },
      "right": {
        "at": 4.907,
        "dur": 0.739
      },
      "closing": {
        "at": 5.746,
        "dur": 1.15
      }
    },
    "name0": {
      "tokyo": {
        "at": 0,
        "dur": 0.65
      },
      "yokohama": {
        "at": 0.75,
        "dur": 0.84
      },
      "susukino": {
        "at": 1.69,
        "dur": 0.908
      },
      "nishiki": {
        "at": 2.699,
        "dur": 0.633
      },
      "nara": {
        "at": 3.432,
        "dur": 0.378
      },
      "koyasan": {
        "at": 3.91,
        "dur": 0.613
      }
    },
    "name1": {
      "kanazawa": {
        "at": 0,
        "dur": 0.778
      },
      "takayama": {
        "at": 0.878,
        "dur": 0.778
      },
      "uji": {
        "at": 1.755,
        "dur": 0.504
      },
      "kiyomizu": {
        "at": 2.36,
        "dur": 0.904
      },
      "shirakawa-go": {
        "at": 3.363,
        "dur": 1.066
      },
      "arashiyama": {
        "at": 4.53,
        "dur": 0.856
      }
    },
    "name2": {
      "fukuoka": {
        "at": 0,
        "dur": 0.756
      },
      "karuizawa": {
        "at": 0.856,
        "dur": 0.753
      },
      "hiroshima": {
        "at": 1.709,
        "dur": 0.681
      },
      "chukagai": {
        "at": 2.49,
        "dur": 0.683
      },
      "nagoya": {
        "at": 3.273,
        "dur": 0.529
      },
      "sendai": {
        "at": 3.902,
        "dur": 0.56
      }
    },
    "name3": {
      "fushimi-inari": {
        "at": 0,
        "dur": 1.023
      },
      "dotonbori": {
        "at": 1.123,
        "dur": 0.749
      },
      "otaru": {
        "at": 1.972,
        "dur": 0.514
      },
      "yoshino": {
        "at": 2.586,
        "dur": 0.712
      },
      "shizuoka": {
        "at": 3.399,
        "dur": 0.753
      },
      "kawasaki": {
        "at": 4.252,
        "dur": 0.836
      }
    },
    "name4": {
      "kamakura": {
        "at": 0,
        "dur": 0.778
      },
      "enoshima": {
        "at": 0.878,
        "dur": 0.693
      },
      "himeji": {
        "at": 1.671,
        "dur": 0.6
      },
      "kobe": {
        "at": 2.371,
        "dur": 0.474
      },
      "shinsekai": {
        "at": 2.945,
        "dur": 0.915
      },
      "ginza": {
        "at": 3.96,
        "dur": 0.437
      }
    }
  }
} as const
