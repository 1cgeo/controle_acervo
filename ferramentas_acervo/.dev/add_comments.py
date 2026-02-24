import os
import pathlib
import re

# Define folders to ignore
FOLDERS_TO_IGNORE = ['.git', 'node_modules', 'vendors', 'images', 'assets', '.dev']

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

def add_comment_to_file(file_path, relative_path):
    """Add or replace a comment in the file, using the appropriate format and position."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Determine comment format and placement based on file extension
        if file_path.endswith('.ui'):
            # XML comment format for .ui files - should be on second line
            comment = f"<!-- Path: {relative_path} -->"
            
            lines = content.split('\n')
            if len(lines) < 1:
                # File is empty, just add content
                new_content = f"{comment}\n"
                print(f"XML comment added to empty file: {relative_path}")
            else:
                # Keep the first line (XML declaration)
                first_line = lines[0]
                
                # Check if second line already contains a comment
                if len(lines) > 1 and "<!-- Path:" in lines[1]:
                    # Replace the existing comment
                    lines[1] = comment
                    new_content = '\n'.join(lines)
                    print(f"XML comment updated in: {relative_path}")
                else:
                    # Insert new comment as the second line
                    new_content = first_line + '\n' + comment + '\n' + '\n'.join(lines[1:] if len(lines) > 1 else [])
                    print(f"XML comment inserted as second line in: {relative_path}")
        else:
            # Python comment format for .py files - should be first line
            comment = f"# Path: {relative_path}"
            
            lines = content.split('\n')
            if lines and lines[0].startswith('# Path:'):
                # Replace existing path comment
                lines[0] = comment
                new_content = '\n'.join(lines)
                print(f"Python comment updated in: {relative_path}")
            else:
                # Add new comment at the beginning
                new_content = comment + '\n' + content
                print(f"Python comment added to: {relative_path}")
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
    
    except Exception as e:
        print(f"Error processing file {relative_path}: {str(e)}")

def process_files(project_root, current_dir, script_dir, ignore_patterns):
    """Process .py and .ui files recursively, excluding the script directory."""
    for item in os.listdir(current_dir):
        full_path = os.path.join(current_dir, item)
        relative_path = os.path.relpath(full_path, project_root)
        
        # Skip if the item should be ignored
        if should_ignore(item, relative_path, ignore_patterns):
            continue
        
        # Skip the script directory itself
        if os.path.samefile(full_path, script_dir):
            continue
        
        if os.path.isdir(full_path):
            # Recursively process directories
            process_files(project_root, full_path, script_dir, ignore_patterns)
        elif item.endswith('.py') or item.endswith('.ui'):
            # Process .py and .ui files
            add_comment_to_file(full_path, relative_path)

def main():
    # Get the current script directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Get the parent directory (project root)
    project_root = os.path.dirname(script_dir)
    
    print(f"Running script from: {script_dir}")
    print(f"Processing files in: {project_root}")
    
    # Read .gitignore patterns
    ignore_patterns = read_gitignore(project_root)
    
    # Process files, excluding the script directory
    process_files(project_root, project_root, script_dir, ignore_patterns)
    
    print("Finished processing .py and .ui files.")

if __name__ == "__main__":
    main()