import os
import shutil
import pathlib

# Define destination folder name
DEST_FOLDER_NAME = 'src_total'

# Define folders to ignore
FOLDERS_TO_IGNORE = ['.git', 'node_modules', 'vendors', 'images', 'assets', '.dev']

# Define file extensions to ignore
FILE_EXTENSIONS_TO_IGNORE = ['.gitignore', '.png', '.svg']

def read_gitignore(project_root):
    """Read .gitignore file and return patterns to ignore."""
    gitignore_path = os.path.join(project_root, '.gitignore')
    ignore_patterns = []
    
    if os.path.exists(gitignore_path):
        with open(gitignore_path, 'r') as f:
            ignore_patterns = [line.strip() for line in f.readlines() 
                              if line.strip() and not line.startswith('#')]
    
    return ignore_patterns

def should_ignore(item, rel_path, ignore_patterns):
    """Determine if a file or directory should be ignored."""
    # Check if the item is in the folders to ignore list
    if item in FOLDERS_TO_IGNORE:
        return True
    
    # Check against gitignore patterns (simplified matching)
    for pattern in ignore_patterns:
        if pattern.endswith('/') and rel_path.startswith(pattern[:-1] + os.sep):
            return True
        elif pattern.startswith('*') and rel_path.endswith(pattern[1:]):
            return True
        elif pattern.endswith('*') and rel_path.startswith(pattern[:-1]):
            return True
        elif rel_path == pattern or rel_path.startswith(pattern + os.sep):
            return True
    
    return False

def should_ignore_file_extension(file_path):
    """Check if the file extension is in the list of extensions to ignore."""
    # Check if the file is .gitignore
    if file_path.endswith('.gitignore'):
        return True
    
    # Check for specific file extensions
    _, extension = os.path.splitext(file_path)
    return extension.lower() in ['.png', '.svg']

def ensure_directory_exists(dir_path):
    """Create directory if it doesn't exist."""
    if not os.path.exists(dir_path):
        os.makedirs(dir_path)
        print(f"Created directory: {dir_path}")

def copy_files_to_destination(project_root, dest_dir, current_dir, script_dir, ignore_patterns):
    """Copy files to destination with path-based naming, excluding script directory."""
    for item in os.listdir(current_dir):
        full_path = os.path.join(current_dir, item)
        relative_path = os.path.relpath(full_path, project_root)
        
        # Skip if the item should be ignored
        if should_ignore(item, relative_path, ignore_patterns):
            continue
        
        # Skip the script directory and the destination directory
        if os.path.exists(script_dir) and os.path.samefile(full_path, script_dir):
            continue
        if os.path.exists(dest_dir) and (os.path.samefile(full_path, dest_dir) or 
                                         dest_dir.startswith(full_path)):
            continue
        
        if os.path.isdir(full_path):
            # Recursively process directories
            copy_files_to_destination(project_root, dest_dir, full_path, script_dir, ignore_patterns)
        else:
            # Skip files with ignored extensions
            if should_ignore_file_extension(full_path):
                print(f"Skipping ignored file type: {relative_path}")
                continue
                
            # Process the file: rename using path components joined with underscores
            path_parts = relative_path.split(os.sep)
            new_filename = '_'.join(path_parts)
            dest_path = os.path.join(dest_dir, new_filename)
            
            # Copy the file with the new name
            shutil.copy2(full_path, dest_path)
            print(f"Copied: {relative_path} -> {new_filename}")

def main():
    # Get the current script directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Get the parent directory (project root)
    project_root = os.path.dirname(script_dir)
    
    # Define destination path
    dest_dir = os.path.join(project_root, DEST_FOLDER_NAME)
    
    # Ensure destination directory exists
    ensure_directory_exists(dest_dir)
    
    print(f"Copying files from {project_root} to {dest_dir}")
    
    # Read .gitignore patterns
    ignore_patterns = read_gitignore(project_root)
    
    # Copy files, excluding the script directory and destination
    copy_files_to_destination(project_root, dest_dir, project_root, script_dir, ignore_patterns)
    
    print("Finished copying and renaming files.")

if __name__ == "__main__":
    main()