# stations
Masonfield - MS
Marigot Jn. (between MS and DC, where the GJ branch joins) - MC
Cosdall Castle - CC
Glassbury Jucntion - GJ
Dovedale Central - DC
Gleethrop End - GE
Perthyne - PE
Mazewood - MW
Wington Mount - WM
Cosdale Harbour - CH
Dovedale East - DE
Satus - SAT
Conby - CO
Fanory Mill - FM
Benyhone Loop (between FM and AB) - BL
Fisherman's Halt (between BL and AB) - FH
Ashburn - AB

# Network
The mainline is MS-MC-DC-WM-DE-SAT-CO-FM-BL-FH-AB.

The GJ branch joins at MC, towards DC: i.e. GJ-CC-MC-DC...

The MW brach joins at DC, towards DE: i.e. MW-PE-GE-DC-WM...

The CH branch diverts at DC, skips WM, stops at CH, then joins again at DE, i.e. ..-DC-CH-DE-SAT..

# Sidings and depots and more
MSSDG - MS siding
GJSDG - GJ Siding
MWSDG - MW Siding
DCSDG - DC siding
CHYRD - CH yard
SATSDG - SAT siding
FMSDG - FM siding
ABSDG - AB siding

# CSV template - UP
```
Train ID,
Departs,
From,
UP,
To,
Ashburn Sdg.,Dep
ASHBURN,Arr
,Dep
,plt
FISHERMAN'S HALT,Dep
Benyhone Loop,Dep
,lne
Fanory Mill Sdg.,Dep
FANORY MILL,Arr
,Dep
,plt
CONBY,Dep
STATUS,Arr
,Dep
,plt
Satus Sdg.,Dep
DOVEDALE EAST,Arr
,Dep
,Plt
,lne
Cosdale Harbour Yd.,Arr
,lne
COSDALE HARBOUR,Arr
,Dep
WINGTON MOUNT,Dep
Dovedale Central Sdg.,Dep
DOVEDALE CENTRAL,Arr
,Dep
,pth
,plt
,lne
GLEETHROP END,Arr
,Dep
,plt
PERTHYNE,Dep
MAZEWOOD,Arr
,Dep
,plt
Mazewood Sdg.,Arr
Marigot Jn.,Dep
,lne
CODSALL CASTLE,Arr
GLASSBURY JN.,Arr
,Dep
,plt
Glassbury Sdg.,Arr
MASONFIELD,Arr
,Dep
,plt
Masonfield Sdg.,Arr
,lne
```

# CSV Template - down
```
Train ID,
Departs,
From,
UP,
To,
Masonfield Sdg.,Dep
,lne
MASONFIELD,Dep
,Arr
,plt
Glassbury Sdg.,Dep
GLASSBUBRY JN.,Dep
,Arr
,plt
CODSALL CASTLE,Dep
Marigot Jn.,Dep
,pth
Mazewood Sdg.,Dep
MAZEWOOD,Dep
,Arr
,plt
PERTHYNE,Dep
GLEETHROP END,Arr
,Dep
,plt
DOVEDALE CENTRAL,Arr
,Dep
,pth
,plt
,lne
Dovedale Central Sdg.,Arr
WINGTON MOUNT,Dep
COSDALE HARBOUR,Arr
,Dep
,plt
Cosdale Harbour Yd.,Arr
,Dep
,lne
DOVEDALE EAST,Arr
,Dep
,plt
SATUS,Arr
,Dep
,plt
Satus Sdg.,Arr
CONBY,Dep
FANORY MILL,Arr
,Dep
,plt
Fanory Mill Sdg.,Arr
Benyhone Loop,Dep
,lne
FISHERMAN'S HALT,Dep
ASHBURN,Arr
,plt
Ashburn Sdg.,Arr
```

# Lines
MS-MC: Double track
MC-CC: Double track (due passing loop)
CC-GJ: Single track
MC-DC: Double track
DC-GE: Double track
GE-MW: Single track
DC-DE (via WM): Double track
DC-CH: Single track
CH-DE: Single track
DE-SAT: Single track
SAT-FM: Single track
FM-BL: Single track
BL-AB: Single track