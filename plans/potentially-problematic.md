Potentially problematic commands:

  1. git show d0d978e:src-tauri/src/navigation_mode.rs                                                        
  2. pnpm tsc --noEmit 2>&1 | head -100                                                                       
  3. cd /Users/zac/Documents/juice/mort/mortician/src-tauri && cargo check 2>&1                               
  4. cd /Users/zac/Documents/juice/mort/mortician/src-tauri && cargo build 2>&1                               
  5. pnpm tsc --noEmit 2>&1 | head -100                                                                       
  6. pnpm test src/components/control-panel 2>&1                                                              
  7. pnpm test src/components/inbox 2>&1                                                                      
  8. git -C /Users/zac/Documents/juice/mort/mortician diff --name-only HEAD | grep -E "(inbox|control-panel)" 
  | head -20                                                                                                  
  9. pnpm test src/entities/__tests__/events-control-panel.test.ts 2>&1                                       
  10. pnpm test src/components/control-panel/__tests__/view-types.test.ts 2>&1                                
  11. pnpm test src/components/control-panel 2>&1                                                             
  12. pnpm tsc --noEmit 2>&1                                                                                  
  13. pnpm tsc --noEmit 2>&1 | head -20                                                                       
  14. pnpm tsc --noEmit 2>&1                                                                                  
  15. git -C /Users/zac/Documents/juice/mort/mortician diff --name-only | grep main-window-layout             
  16. git -C /Users/zac/Documents/juice/mort/mortician diff HEAD -- src/entities/events.ts                    
  src/components/control-panel/control-panel-window.tsx                                                       
  src/components/control-panel/use-control-panel-params.ts                                                    
  src/components/control-panel/control-panel-header.tsx                                                       
  src/components/control-panel/__tests__/view-types.test.ts 2>&1 | head -200                                  
  17. pnpm test src/components/control-panel 2>&1                                                             
  18. pnpm test -- --run src/lib/__tests__/event-bridge-control-panel.test.ts                                 
  src/entities/__tests__/events-control-panel.test.ts 2>&1 | head -50                                         
  19. pnpm test --run src/lib/__tests__/event-bridge-control-panel.test.ts                                    
  src/entities/__tests__/events-control-panel.test.ts --reporter=verbose 2>&1 | tail -50                      
  20. pnpm test --run "src/components/inbox/__tests__/*.test.*" --reporter=verbose 2>&1 | tail -80            
  21. pnpm test --run src/components/inbox/__tests__ --reporter=verbose 2>&1 | tail -100                      
  22. pnpm test --run src/components/inbox/__tests__ --reporter=verbose 2>&1 | tail -60                       
  23. cd /Users/zac/Documents/juice/mort/mortician/src-tauri && cargo check 2>&1 | tail -30                   
  24. pnpm test --run src/components/control-panel/__tests__/view-types.test.ts --reporter=verbose 2>&1 | tail
   -40                                                                                                        
  25. pnpm test --run src/lib/__tests__/hotkey-service-control-panel.test.ts --reporter=verbose 2>&1 | tail   
  -40                                                                                                         
  26. pnpm test --run src/components/control-panel/__tests__/window-routing.test.tsx --reporter=verbose 2>&1 |
   tail -50                                                                                                   
  27. pnpm test --run src/components/control-panel/__tests__ --reporter=verbose 2>&1 | tail -60   