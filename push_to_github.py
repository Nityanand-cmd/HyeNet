# ============================================================
#  HygieNet — 1-Click Push to GitHub Script
# ============================================================

import sys
import os
import dulwich.porcelain as p

REPO_URL = "https://github.com/Nityanand-cmd/HyeNet.git"

def push(token=None):
    if not token:
        if len(sys.argv) > 1:
            token = sys.argv[1].strip()
        else:
            print("=" * 60)
            print("  Push to GitHub: https://github.com/Nityanand-cmd/HyeNet")
            print("=" * 60)
            token = input("Enter your GitHub Personal Access Token (or press Enter to try default): ").strip()

    repo = p.open_repo('.')
    
    # Check if there are uncommitted changes and commit them
    status = p.status(repo)
    if status.untracked or status.staged['add'] or status.staged['modify'] or status.unstaged:
        files_to_stage = []
        for path in status.unstaged + [f.encode() if isinstance(f, str) else f for f in status.untracked]:
            p_str = path.decode('utf-8') if isinstance(path, bytes) else str(path)
            if p_str not in ('.', './', '.env', '.env.local') and not p_str.startswith('.git'):
                files_to_stage.append(p_str)
        if files_to_stage:
            repo.stage(files_to_stage)
        p.commit(
            repo,
            message="feat: add menstrual period tracker, bilingual AI chatbot (HygieBot), and fix user login sync",
            author="Nityanand-cmd <nityanand@users.noreply.github.com>",
            committer="Nityanand-cmd <nityanand@users.noreply.github.com>"
        )
        print("[Git] Committed local changes.")


    if token:
        # Push using token
        auth_url = REPO_URL.replace("https://", f"https://{token}@")
        print(f"[Git] Pushing to {REPO_URL} (branch: main)...")
        try:
            p.push(repo, auth_url, "main")
            print("\n[SUCCESS] Successfully pushed HygieNet to GitHub!")
            print("Visit: https://github.com/Nityanand-cmd/HyeNet")
        except Exception as e:
            print(f"\n[ERROR] Push failed: {e}")
    else:
        try:
            p.push(repo, REPO_URL, "main")
            print("\n[SUCCESS] Pushed to GitHub!")
        except Exception as e:
            print(f"\n[ERROR] {e}")

if __name__ == "__main__":
    push()
