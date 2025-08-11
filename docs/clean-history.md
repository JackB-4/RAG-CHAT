# Remove sensitive files from Git history

If a personal database or documents were committed (e.g., `backend/data/knowledge.db`), do the following:

1. Make sure current working tree is clean and the file is removed from HEAD:
   - `.gitignore` contains the patterns
   - `git rm --cached -r backend/data`
   - `git commit -m "remove tracked data"` and `git push`

2. Rewrite history to purge the file. Two options:

Option A) Using git filter-repo (recommended)
- Install: https://github.com/newren/git-filter-repo
- Then run:

  powershell
  git filter-repo --path backend/data/knowledge.db --invert-paths
  git push --force --tags origin main

Option B) Using BFG Repo-Cleaner
- Download: https://rtyley.github.io/bfg-repo-cleaner/
- Then run:

  powershell
  java -jar bfg.jar --delete-files knowledge.db
  git reflog expire --expire=now --all
  git gc --prune=now --aggressive
  git push --force --tags origin main

Note: Force-pushing rewrites history for everyone. Coordinate with collaborators. Afterward, ask GitHub to re-run any releases if needed.
