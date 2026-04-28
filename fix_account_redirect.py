
import os

file_path = 'create-account.html'
temp_file_path = 'create-account.html.tmp'

old_code_block = """sb.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session) {
    let pending = {};
    try { pending = JSON.parse(localStorage.getItem('p_pending_profile') || '{}'); } catch(e) {}
    await saveSessionAndProfile(session, pending);
    localStorage.removeItem('p_pending_profile');
    const role = pending.role || 'user';
    const dest = role === 'organizer' ? 'organizer-dashboard.html'
      : role === 'business' ? 'business-dashboard.html'
      : 'index.html';
    window.location.href = dest;
  }
});"""

new_code_block = """sb.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session) {
    let pending = {};
    try { pending = JSON.parse(localStorage.getItem('p_pending_profile') || '{}'); } catch(e) {}
    
    const role = pending.role || 'user';
    const dest = role === 'organizer' ? 'organizer-dashboard.html'
      : role === 'business' ? 'business-dashboard.html'
      : 'index.html';

    // The user has just signed in. Redirect them immediately.
    window.location.href = dest;

    // After starting the redirect, do the cleanup and save in the background.
    await saveSessionAndProfile(session, pending);
    localStorage.removeItem('p_pending_profile');
  }
});"""

try:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    if old_code_block in content:
        new_content = content.replace(old_code_block, new_code_block)
        
        with open(temp_file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
            
        os.replace(temp_file_path, file_path)
        print("Successfully patched create-account.html")
    else:
        # If the exact block isn't found, try a more surgical replacement
        # This is a fallback in case formatting is slightly different
        line_to_find = "    await saveSessionAndProfile(session, pending);"
        if line_to_find in content:
            replacement_logic = """    const role = pending.role || 'user';
    const dest = role === 'organizer' ? 'organizer-dashboard.html'
      : role === 'business' ? 'business-dashboard.html'
      : 'index.html';
    window.location.href = dest;
"""
            # Replace the broken re-direct logic
            content = content.replace("""    localStorage.removeItem('p_pending_profile');
    const role = pending.role || 'user';
    const dest = role === 'organizer' ? 'organizer-dashboard.html'
      : role === 'business' ? 'business-dashboard.html'
      : 'index.html';
    window.location.href = dest;""", "    localStorage.removeItem('p_pending_profile');")

            # Insert the new logic before the save function
            content = content.replace(line_to_find, replacement_logic + line_to_find)

            with open(temp_file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            
            os.replace(temp_file_path, file_path)
            print("Successfully patched create-account.html using fallback method.")
        else:
            print("Could not find the target code block in create-account.html. No changes made.")

except FileNotFoundError:
    print(f"Error: {file_path} not found.")
except Exception as e:
    print(f"An error occurred: {e}")
    if os.path.exists(temp_file_path):
        os.remove(temp_file_path)
