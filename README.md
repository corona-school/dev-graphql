# CLI for working with GraphQL

_Jonas had to reinvent wheels again. You might want to use a non-buggy more feature complete existing GraphQL client instead._

Can be installed through `apt install vim && npm ci && sudo npm link`. Afterwards `graphql` can be run everywhere.

In multi selects, space can be used to select entries, `a` to toggle all and enter to submit. 

![Examples](./examples.png)

### Usage

```
graphql                  - Starts the CLI in interactive mode
graphql load <file>.gql  - Starts the CLI with loading / running the query in the file, can then be edited
graphql run  <file>.gql  - Directly runs the Query and exits
```