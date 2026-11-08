export type ArtWindow = { x: number; y: number; w: number; h: number };
/** Original-art PNGs. Metadata is maintained by import-spirit-artwork.py. */
export const restoredSpirits: Record<string, {
  src: string;
  size: { w: number; h: number };
  crop: { x: number; y: number; w: number; h: number };
  placement: ArtWindow;
}> = {
  "windy": {
    "src": "/spirits/windy-restored-v1.png",
    "size": {
      "w": 869,
      "h": 1810
    },
    "crop": {
      "x": 0,
      "y": 39,
      "w": 749,
      "h": 1667
    },
    "placement": {
      "x": 0.16,
      "y": 0.1171805264,
      "w": 0.68,
      "h": 0.6756389472
    }
  },
  "fly": {
    "src": "/spirits/fly-restored-v1.png",
    "size": {
      "w": 881,
      "h": 1785
    },
    "crop": {
      "x": 29,
      "y": 0,
      "w": 832,
      "h": 1763
    },
    "placement": {
      "x": 0.16,
      "y": 0.1333675309,
      "w": 0.68,
      "h": 0.6432649382
    }
  },
  "shadow": {
    "src": "/spirits/shadow-restored-v1.png",
    "size": {
      "w": 855,
      "h": 1839
    },
    "crop": {
      "x": 27,
      "y": 198,
      "w": 741,
      "h": 1581
    },
    "placement": {
      "x": 0.16,
      "y": 0.1311495084,
      "w": 0.68,
      "h": 0.6477009832
    }
  },
  "watery": {
    "src": "/spirits/watery-restored-v1.png",
    "size": {
      "w": 858,
      "h": 1832
    },
    "crop": {
      "x": 83,
      "y": 9,
      "w": 739,
      "h": 1759
    },
    "placement": {
      "x": 0.16,
      "y": 0.0937130292,
      "w": 0.68,
      "h": 0.7225739416
    }
  },
  "rain": {
    "src": "/spirits/rain-restored-v3.png",
    "size": {
      "w": 838,
      "h": 1877
    },
    "crop": {
      "x": 97,
      "y": 31,
      "w": 638,
      "h": 1794
    },
    "placement": {
      "x": 0.211,
      "y": 0.123,
      "w": 0.5696,
      "h": 0.715
    }
  },
  "wood": {
    "src": "/spirits/wood-restored-v1.png",
    "size": {
      "w": 858,
      "h": 1832
    },
    "crop": {
      "x": 41,
      "y": 24,
      "w": 718,
      "h": 1776
    },
    "placement": {
      "x": 0.1694612613,
      "y": 0.09,
      "w": 0.6610774775,
      "h": 0.73
    }
  },
  "jump": {
    "src": "/spirits/jump-restored-v1.png",
    "size": {
      "w": 935,
      "h": 1681
    },
    "crop": {
      "x": 0,
      "y": 8,
      "w": 885,
      "h": 1673
    },
    "placement": {
      "x": 0.16,
      "y": 0.1680649718,
      "w": 0.68,
      "h": 0.5738700565
    }
  },
  "illusion": {
    "src": "/spirits/illusion-restored-v1.png",
    "size": {
      "w": 887,
      "h": 1774
    },
    "crop": {
      "x": 19,
      "y": 17,
      "w": 852,
      "h": 1757
    },
    "placement": {
      "x": 0.16,
      "y": 0.1419865023,
      "w": 0.68,
      "h": 0.6260269953
    }
  },
  "silent": {
    "src": "/spirits/silent-restored-v1.png",
    "size": {
      "w": 870,
      "h": 1808
    },
    "crop": {
      "x": 90,
      "y": 33,
      "w": 663,
      "h": 1735
    },
    "placement": {
      "x": 0.187568415,
      "y": 0.09,
      "w": 0.62486317,
      "h": 0.73
    }
  },
  "thunder": {
    "src": "/spirits/thunder-restored-v1.png",
    "size": {
      "w": 866,
      "h": 1816
    },
    "crop": {
      "x": 25,
      "y": 14,
      "w": 815,
      "h": 1783
    },
    "placement": {
      "x": 0.16,
      "y": 0.12293383,
      "w": 0.68,
      "h": 0.6641323401
    }
  },
  "sword": {
    "src": "/spirits/sword-restored-v1.png",
    "size": {
      "w": 864,
      "h": 1821
    },
    "crop": {
      "x": 0,
      "y": 9,
      "w": 858,
      "h": 1812
    },
    "placement": {
      "x": 0.16,
      "y": 0.1344455544,
      "w": 0.68,
      "h": 0.6411088911
    }
  },
  "flower": {
    "src": "/spirits/flower-restored-v1.png",
    "size": {
      "w": 906,
      "h": 1735
    },
    "crop": {
      "x": 0,
      "y": 15,
      "w": 872,
      "h": 1720
    },
    "placement": {
      "x": 0.16,
      "y": 0.1556061599,
      "w": 0.68,
      "h": 0.5987876802
    }
  },
  "shield": {
    "src": "/spirits/shield-restored-v1.png",
    "size": {
      "w": 889,
      "h": 1769
    },
    "crop": {
      "x": 58,
      "y": 17,
      "w": 736,
      "h": 1670
    },
    "placement": {
      "x": 0.16,
      "y": 0.1105949146,
      "w": 0.68,
      "h": 0.6888101708
    }
  },
  "time": {
    "src": "/spirits/time-restored-v1.png",
    "size": {
      "w": 878,
      "h": 1792
    },
    "crop": {
      "x": 0,
      "y": 42,
      "w": 764,
      "h": 1716
    },
    "placement": {
      "x": 0.16,
      "y": 0.1140781601,
      "w": 0.68,
      "h": 0.6818436799
    }
  },
  "power": {
    "src": "/spirits/power-restored-v1.png",
    "size": {
      "w": 885,
      "h": 1777
    },
    "crop": {
      "x": 57,
      "y": 15,
      "w": 810,
      "h": 1762
    },
    "placement": {
      "x": 0.16,
      "y": 0.124819224,
      "w": 0.68,
      "h": 0.660361552
    }
  },
  "mist": {
    "src": "/spirits/mist-restored-v1.png",
    "size": {
      "w": 865,
      "h": 1819
    },
    "crop": {
      "x": 0,
      "y": 27,
      "w": 785,
      "h": 1737
    },
    "placement": {
      "x": 0.16,
      "y": 0.1191378526,
      "w": 0.68,
      "h": 0.6717242948
    }
  },
  "storm": {
    "src": "/spirits/storm-restored-v1.png",
    "size": {
      "w": 864,
      "h": 1821
    },
    "crop": {
      "x": 15,
      "y": 25,
      "w": 797,
      "h": 1770
    },
    "placement": {
      "x": 0.16,
      "y": 0.1179100197,
      "w": 0.68,
      "h": 0.6741799606
    }
  },
  "float": {
    "src": "/spirits/float-restored-v1.png",
    "size": {
      "w": 881,
      "h": 1785
    },
    "crop": {
      "x": 0,
      "y": 31,
      "w": 878,
      "h": 1730
    },
    "placement": {
      "x": 0.16,
      "y": 0.1559233648,
      "w": 0.68,
      "h": 0.5981532704
    }
  },
  "erase": {
    "src": "/spirits/erase-restored-v1.png",
    "size": {
      "w": 887,
      "h": 1774
    },
    "crop": {
      "x": 49,
      "y": 15,
      "w": 816,
      "h": 1733
    },
    "placement": {
      "x": 0.16,
      "y": 0.132641369,
      "w": 0.68,
      "h": 0.6447172619
    }
  },
  "glow": {
    "src": "/spirits/glow-restored-v1.png",
    "size": {
      "w": 854,
      "h": 1842
    },
    "crop": {
      "x": 73,
      "y": 33,
      "w": 751,
      "h": 1789
    },
    "placement": {
      "x": 0.16,
      "y": 0.0934225794,
      "w": 0.68,
      "h": 0.7231548412
    }
  },
  "move": {
    "src": "/spirits/move-restored-v1.png",
    "size": {
      "w": 877,
      "h": 1793
    },
    "crop": {
      "x": 0,
      "y": 20,
      "w": 851,
      "h": 1749
    },
    "placement": {
      "x": 0.16,
      "y": 0.1430455766,
      "w": 0.68,
      "h": 0.6239088467
    }
  },
  "fight": {
    "src": "/spirits/fight-restored-v1.png",
    "size": {
      "w": 862,
      "h": 1825
    },
    "crop": {
      "x": 0,
      "y": 12,
      "w": 840,
      "h": 1800
    },
    "placement": {
      "x": 0.16,
      "y": 0.129744898,
      "w": 0.68,
      "h": 0.6505102041
    }
  },
  "loop": {
    "src": "/spirits/loop-restored-v1.png",
    "size": {
      "w": 883,
      "h": 1782
    },
    "crop": {
      "x": 47,
      "y": 93,
      "w": 744,
      "h": 1663
    },
    "placement": {
      "x": 0.16,
      "y": 0.1157262865,
      "w": 0.68,
      "h": 0.678547427
    }
  },
  "sleep": {
    "src": "/spirits/sleep-restored-v1.png",
    "size": {
      "w": 849,
      "h": 1853
    },
    "crop": {
      "x": 0,
      "y": 0,
      "w": 846,
      "h": 1853
    },
    "placement": {
      "x": 0.16,
      "y": 0.1225426376,
      "w": 0.68,
      "h": 0.6649147248
    }
  },
  "song": {
    "src": "/spirits/song-restored-v1.png",
    "size": {
      "w": 875,
      "h": 1798
    },
    "crop": {
      "x": 23,
      "y": 17,
      "w": 838,
      "h": 1781
    },
    "placement": {
      "x": 0.16,
      "y": 0.132410075,
      "w": 0.68,
      "h": 0.64517985
    }
  },
  "little": {
    "src": "/spirits/little-restored-v1.png",
    "size": {
      "w": 854,
      "h": 1842
    },
    "crop": {
      "x": 41,
      "y": 34,
      "w": 761,
      "h": 1808
    },
    "placement": {
      "x": 0.16,
      "y": 0.0943842688,
      "w": 0.68,
      "h": 0.7212314624
    }
  },
  "mirror": {
    "src": "/spirits/mirror-restored-v1.png",
    "size": {
      "w": 849,
      "h": 1851
    },
    "crop": {
      "x": 0,
      "y": 12,
      "w": 829,
      "h": 1825
    },
    "placement": {
      "x": 0.16,
      "y": 0.1208517146,
      "w": 0.68,
      "h": 0.6682965707
    }
  },
  "maze": {
    "src": "/spirits/maze-restored-v1.png",
    "size": {
      "w": 869,
      "h": 1810
    },
    "crop": {
      "x": 47,
      "y": 74,
      "w": 776,
      "h": 1728
    },
    "placement": {
      "x": 0.16,
      "y": 0.1170029455,
      "w": 0.68,
      "h": 0.675994109
    }
  },
  "return": {
    "src": "/spirits/return-restored-v1.png",
    "size": {
      "w": 862,
      "h": 1825
    },
    "crop": {
      "x": 40,
      "y": 13,
      "w": 792,
      "h": 1798
    },
    "placement": {
      "x": 0.16,
      "y": 0.1104157648,
      "w": 0.68,
      "h": 0.6891684704
    }
  },
  "shot": {
    "src": "/spirits/shot-restored-v1.png",
    "size": {
      "w": 856,
      "h": 1838
    },
    "crop": {
      "x": 0,
      "y": 39,
      "w": 844,
      "h": 1767
    },
    "placement": {
      "x": 0.16,
      "y": 0.1372211408,
      "w": 0.68,
      "h": 0.6355577183
    }
  },
  "sweet": {
    "src": "/spirits/sweet-restored-v1.png",
    "size": {
      "w": 868,
      "h": 1812
    },
    "crop": {
      "x": 39,
      "y": 21,
      "w": 803,
      "h": 1791
    },
    "placement": {
      "x": 0.16,
      "y": 0.1164592599,
      "w": 0.68,
      "h": 0.6770814802
    }
  },
  "dash": {
    "src": "/spirits/dash-restored-v1.png",
    "size": {
      "w": 838,
      "h": 1877
    },
    "crop": {
      "x": 0,
      "y": 26,
      "w": 832,
      "h": 1838
    },
    "placement": {
      "x": 0.16,
      "y": 0.1196849245,
      "w": 0.68,
      "h": 0.6706301511
    }
  },
  "big": {
    "src": "/spirits/big-restored-v1.png",
    "size": {
      "w": 852,
      "h": 1846
    },
    "crop": {
      "x": 60,
      "y": 41,
      "w": 754,
      "h": 1789
    },
    "placement": {
      "x": 0.16,
      "y": 0.0948612164,
      "w": 0.68,
      "h": 0.7202775673
    }
  },
  "create": {
    "src": "/spirits/create-restored-v1.png",
    "size": {
      "w": 928,
      "h": 1695
    },
    "crop": {
      "x": 0,
      "y": 64,
      "w": 884,
      "h": 1582
    },
    "placement": {
      "x": 0.16,
      "y": 0.1833653846,
      "w": 0.68,
      "h": 0.5432692308
    }
  },
  "change": {
    "src": "/spirits/change-restored-v1.png",
    "size": {
      "w": 923,
      "h": 1703
    },
    "crop": {
      "x": 0,
      "y": 38,
      "w": 904,
      "h": 1633
    },
    "placement": {
      "x": 0.16,
      "y": 0.1808118679,
      "w": 0.68,
      "h": 0.5483762642
    }
  },
  "freeze": {
    "src": "/spirits/freeze-restored-v1.png",
    "size": {
      "w": 845,
      "h": 1860
    },
    "crop": {
      "x": 58,
      "y": 15,
      "w": 769,
      "h": 1829
    },
    "placement": {
      "x": 0.16,
      "y": 0.0939908044,
      "w": 0.68,
      "h": 0.7220183912
    }
  },
  "firey": {
    "src": "/spirits/firey-restored-v1.png",
    "size": {
      "w": 890,
      "h": 1767
    },
    "crop": {
      "x": 0,
      "y": 10,
      "w": 870,
      "h": 1757
    },
    "placement": {
      "x": 0.16,
      "y": 0.1484626437,
      "w": 0.68,
      "h": 0.6130747126
    }
  },
  "snow": {
    "src": "/spirits/snow-restored-v1.png",
    "size": {
      "w": 870,
      "h": 1808
    },
    "crop": {
      "x": 0,
      "y": 21,
      "w": 866,
      "h": 1787
    },
    "placement": {
      "x": 0.16,
      "y": 0.1417886011,
      "w": 0.68,
      "h": 0.6264227978
    }
  },
  "arrow": {
    "src": "/spirits/arrow-restored-v1.png",
    "size": {
      "w": 887,
      "h": 1774
    },
    "crop": {
      "x": 0,
      "y": 15,
      "w": 881,
      "h": 1759
    },
    "placement": {
      "x": 0.16,
      "y": 0.1519454354,
      "w": 0.68,
      "h": 0.6061091292
    }
  },
  "bubbles": {
    "src": "/spirits/bubbles-restored-v1.png",
    "size": {
      "w": 848,
      "h": 1854
    },
    "crop": {
      "x": 57,
      "y": 21,
      "w": 713,
      "h": 1813
    },
    "placement": {
      "x": 0.1784617761,
      "y": 0.09,
      "w": 0.6430764479,
      "h": 0.73
    }
  },
  "through": {
    "src": "/spirits/through-restored-v1.png",
    "size": {
      "w": 858,
      "h": 1832
    },
    "crop": {
      "x": 41,
      "y": 10,
      "w": 807,
      "h": 1822
    },
    "placement": {
      "x": 0.16,
      "y": 0.1123066029,
      "w": 0.68,
      "h": 0.6853867941
    }
  },
  "wave": {
    "src": "/spirits/wave-restored-v1.png",
    "size": {
      "w": 859,
      "h": 1831
    },
    "crop": {
      "x": 41,
      "y": 17,
      "w": 806,
      "h": 1798
    },
    "placement": {
      "x": 0.16,
      "y": 0.1164010989,
      "w": 0.68,
      "h": 0.6771978022
    }
  },
  "libra": {
    "src": "/spirits/libra-restored-v1.png",
    "size": {
      "w": 883,
      "h": 1782
    },
    "crop": {
      "x": 35,
      "y": 3,
      "w": 834,
      "h": 1761
    },
    "placement": {
      "x": 0.16,
      "y": 0.1345028263,
      "w": 0.68,
      "h": 0.6409943474
    }
  },
  "voice": {
    "src": "/spirits/voice-restored-v1.png",
    "size": {
      "w": 872,
      "h": 1802
    },
    "crop": {
      "x": 50,
      "y": 10,
      "w": 808,
      "h": 1792
    },
    "placement": {
      "x": 0.16,
      "y": 0.1183663366,
      "w": 0.68,
      "h": 0.6732673267
    }
  },
  "lock": {
    "src": "/spirits/lock-restored-v2.png",
    "size": {
      "w": 1024,
      "h": 1536
    },
    "crop": {
      "x": 0,
      "y": 39,
      "w": 931,
      "h": 1401
    },
    "placement": {
      "x": 0.16,
      "y": 0.2265877704,
      "w": 0.68,
      "h": 0.4568244591
    }
  },
  "cloud": {
    "src": "/spirits/cloud-restored-v1.png",
    "size": {
      "w": 917,
      "h": 1716
    },
    "crop": {
      "x": 0,
      "y": 22,
      "w": 819,
      "h": 1640
    },
    "placement": {
      "x": 0.16,
      "y": 0.1510579103,
      "w": 0.68,
      "h": 0.6078841793
    }
  },
  "dream": {
    "src": "/spirits/dream-restored-v1.png",
    "size": {
      "w": 851,
      "h": 1847
    },
    "crop": {
      "x": 82,
      "y": 45,
      "w": 688,
      "h": 1778
    },
    "placement": {
      "x": 0.1836283465,
      "y": 0.09,
      "w": 0.6327433071,
      "h": 0.73
    }
  },
  "sand": {
    "src": "/spirits/sand-restored-v1.png",
    "size": {
      "w": 860,
      "h": 1829
    },
    "crop": {
      "x": 50,
      "y": 53,
      "w": 767,
      "h": 1731
    },
    "placement": {
      "x": 0.16,
      "y": 0.1124431924,
      "w": 0.68,
      "h": 0.6851136152
    }
  },
  "light": {
    "src": "/spirits/light-restored-v1.png",
    "size": {
      "w": 862,
      "h": 1824
    },
    "crop": {
      "x": 35,
      "y": 19,
      "w": 807,
      "h": 1792
    },
    "placement": {
      "x": 0.16,
      "y": 0.1179491945,
      "w": 0.68,
      "h": 0.6741016109
    }
  },
  "dark": {
    "src": "/spirits/dark-restored-v1.png",
    "size": {
      "w": 847,
      "h": 1857
    },
    "crop": {
      "x": 54,
      "y": 12,
      "w": 763,
      "h": 1833
    },
    "placement": {
      "x": 0.16,
      "y": 0.0903562067,
      "w": 0.68,
      "h": 0.7292875866
    }
  },
  "twin": {
    "src": "/spirits/twin-restored-v1.png",
    "size": {
      "w": 887,
      "h": 1774
    },
    "crop": {
      "x": 33,
      "y": 30,
      "w": 818,
      "h": 1744
    },
    "placement": {
      "x": 0.16,
      "y": 0.1313884038,
      "w": 0.68,
      "h": 0.6472231925
    }
  },
  "earthy": {
    "src": "/spirits/earthy-restored-v1.png",
    "size": {
      "w": 845,
      "h": 1860
    },
    "crop": {
      "x": 37,
      "y": 7,
      "w": 794,
      "h": 1853
    },
    "placement": {
      "x": 0.16,
      "y": 0.1007696114,
      "w": 0.68,
      "h": 0.7084607773
    }
  }
};
