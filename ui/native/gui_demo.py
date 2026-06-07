"""A real native Tkinter (X11) app — proof voidOS can run native GUI apps
against a display server (here: a headless Xvfb), not a browser."""
import tkinter as tk

root = tk.Tk()
root.title("voidOS Native App")
root.geometry("460x300")
root.configure(bg="#0d1117")

tk.Label(root, text="▸ voidOS", fg="#29a7e6", bg="#0d1117",
         font=("DejaVu Sans", 24, "bold")).pack(pady=(26, 2))
tk.Label(root, text="a native Tkinter window (X11) — not a web page",
         fg="#8a94a3", bg="#0d1117", font=("DejaVu Sans", 11)).pack()

c = tk.Canvas(root, width=400, height=90, bg="#11161c",
              highlightthickness=1, highlightbackground="#232c38")
c.pack(pady=18)
c.create_text(200, 34, text="rendered by Tk into a real X display",
              fill="#2fd07f", font=("DejaVu Sans", 12))
c.create_rectangle(150, 56, 250, 76, outline="#29a7e6")
c.create_text(200, 66, text="syscalls →", fill="#d7dee7", font=("DejaVu Sans", 10))

btns = tk.Frame(root, bg="#0d1117")
btns.pack()
for label, col in [("OK", "#29a7e6"), ("Cancel", "#f0584f")]:
    tk.Button(btns, text=label, fg="#ffffff", bg=col, relief="flat",
              padx=18, pady=6, font=("DejaVu Sans", 11)).pack(side="left", padx=6)

root.update()
root.mainloop()
