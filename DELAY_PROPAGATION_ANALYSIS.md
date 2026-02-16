## Delay Propagation Issue: 2C11 → 2A11

### Problem Identified

**2C11** is on **WTT-UP** sheet:
- Has delays: FANORY MILL (+10 min), WINGTON MOUNT (+20 min)
- Next row shows: "2A11" at "Masonfield Sdg."

**2A11** is on **WTT-DOWN** sheet:
- No delays recorded in its own delay history
- Should inherit +20 min from 2C11

### Root Cause

The `getAnticipatedDelay()` function is called with delay context from ONLY the current sheet:

```javascript
// In buildLineups(), for each sheet:
const delayContext = delayContexts[sheet]; // Only WTT-DOWN for 2A11
const anticipatedDelay = considerDelays
  ? getAnticipatedDelay(
      delayContext.history,      // WTT-DOWN history only
      delayContext.locationOrder,
      delayContext.locationIndices,
      delayContext.headcodeChain, // WTT-DOWN chains only
      entry.headcode,             // 2A11
      location
    )
  : 0;
```

When processing 2A11 (on WTT-DOWN):
1. It looks for delays in WTT-DOWN's history → finds nothing
2. It looks for previous service in WTT-DOWN's chains → finds nothing
3. **But 2C11 exists on WTT-UP!** The cross-sheet chain is invisible!

### Solution Required

The delay propagation needs to:
1. Accept ALL delay contexts (from all sheets), not just the current sheet
2. When looking for previous service chains, search across ALL sheets
3. When a cross-sheet chain is found (e.g., 2C11 on WTT-UP → 2A11 on WTT-DOWN), look in the correct sheet's delay history

This is a **cross-sheet delay propagation** issue where service chains span multiple sheets but the current code only searches within a single sheet's context.
