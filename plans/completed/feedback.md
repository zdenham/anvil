1.

The data models is not meant to be a full reference its more meant to be an implementation doc for scaffolding the various stores.

Also an important implementation detail is that we want to ensure type files are separated from the actual store so contracts can be easily read. Can you please refine the plan according to this update. Also please make sure types for the zustand store data model are up to date with the system-integration plan.

We would like to introduce a pattern of using reducers with mitt emitted events with zustand. There will be many events thrown around so we want a consistent pattern. Any store should be able to subscribe to an event and update its state accordingly. This will also enable us to create explicit state machines. Any events emitted from the node or rust process should emit via this service on the web app side, and then we will use reducer pattern in each of the zustand stores.

We should document this pattern in Agents.md very concisely (prefer using event driven approach with mitt).

Please make sure this is encapsulated in the data models plan

2. ✅ ADDRESSED in `conversation-chat-ui/02-hooks.md`

For the agent stream state hook, the state should not be stored locally in react state. It should be backed by the appropriate zustand store

3. ✅ ADDRESSED in `conversation-chat-ui/02-hooks.md`

Use useConversation should not be a hook. It should be a service that operates CRUD operations on conversation files with explicit get / fetch etc...

4.

Question. If we want to keep our zustand models pretty "vanilla" crud operations and reducers for emitted events. With this set up, what is the typical pattern for front end business logic.

We have react for the view, zustand is effectively the model. But I'm wondering where the "controller" code typically goes with this sort of set up

6. The agent spawner needs to also support responses. E.G. for an existing conversation it should pass the entire message history which should enable a successive call with context. Can you create a plan to update the Spawner service and agent runner to accomodate this

7. We need to ensure that prompt caching is leveraged for the agent runner

8. There doesn't seem to be a plan to actually implement the UI for the agent front end

9. We need a pattern for pnpm and aliases
