# Delay example

Train 1E01 has timetable:

MS DEP 0900
MC PASS 0902
DC ARR 0904 DEP 0908
WM PASS 0906
DE ARR 0908

1E01 departs MS 5 minutes late, at 0905. In the code currently, delay will therefore be propagated as such:

MS DEP 0900 (0905)
MC PASS 0902 (0907)
DC ARR 0904 (0909) DEP 0908 (0913)
WM PASS 0909 (0914)
DE ARR 0911 (0916)

However, this assumes that delayed trains will take their FULL stoppage time at stations. The real delay propagation should be:

....
MC PASS 0902 (0907)
DC ARR 0904 (0909) DEP 0908 (0909H)
WM PASS 0909 (0910H)
...

I.e. a late train should be estimated a maximum of 30 seconds (H) stoppage time, where stoppage time is provided.