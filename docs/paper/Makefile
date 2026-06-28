all: phantom_protocol_paper.pdf

phantom_protocol_paper.pdf: phantom_protocol_paper.tex references.bib
	pdflatex -interaction=nonstopmode phantom_protocol_paper.tex
	bibtex phantom_protocol_paper.aux
	pdflatex -interaction=nonstopmode phantom_protocol_paper.tex
	pdflatex -interaction=nonstopmode phantom_protocol_paper.tex

clean:
	rm -f *.aux *.log *.out *.pdf *.blg *.bbl
