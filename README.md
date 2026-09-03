# Welcome to the Chowdhury Lab at Iowa State University
### We are a part of the department of Chemical & Biological Engineering and located within the Nanovaccine Institute.

Our interests are discerning structural priors to protein function and utilizing biochemical intuition to design proteins for various use cases. :earth_americas:

## CatLog publish safety

Before every Codex-owned push, run from the repository root:

```bash
python3 scripts/check-catlog-publish.py
```

Push only when it exits 0 and reports that all tracked CatLog data blobs passed.
Any failure is a publication hold.
